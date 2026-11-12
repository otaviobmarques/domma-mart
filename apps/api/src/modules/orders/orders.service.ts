import { blindIndex } from '../../common/crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService, Tx } from '../../infra/prisma.service';
import { LedgerService, Entry } from '../ledger/ledger.service';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { canTransition, OrderStatus, POST_PAID } from '../../domain/order-state';
import { releaseSchedule, applyBps, Method } from '../../domain/money';
import { applyReserve, reserveFor } from '../../domain/risk';
import { RiskService } from '../risk/risk.service';
import { AppError } from '../../common/errors';
import { AuditService } from '../../infra/audit.service';

/** Custo de processamento do gateway que não volta ao produtor em reembolso (RN-52). */
export function gatewayCost(method: Method, total: bigint): bigint {
  if (method === 'pix') return 99n;
  if (method === 'boleto') return 199n;
  return applyBps(total, 293) + 29n;
}

type Pending = { name: string; payload: any }[];

@Injectable()
export class OrdersService {
  private log = new Logger('Orders');
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private events: EventEmitter2,
    private audit: AuditService,
    @Inject(GATEWAY) private gateway: GatewayAdapter,
    private risk: RiskService,
  ) {}

  /**
   * Única forma de mudar o status de um pedido (seção 8.1). Valida a origem, grava
   * order_events e agenda o evento de domínio para depois do commit.
   */
  async transition(tx: Tx, orderId: string, to: OrderStatus, event: string, data: Record<string, unknown> = {}, pending?: Pending) {
    const [o] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (!o) throw new AppError('NOT_FOUND');
    if (o.status === to) return false;
    if (!canTransition(o.status, to)) {
      this.log.warn(`transição inválida ${o.status} → ${to} (${orderId}, ${event})`);
      return false;
    }
    const extra: Record<string, unknown> = {};
    await tx.orders.update({ where: { id: orderId }, data: { status: to, ...extra } });
    await tx.order_events.create({ data: { order_id: orderId, from_status: o.status, to_status: to, event, data: data as any } });
    pending?.push({ name: `order.${to}`, payload: { orderId, from: o.status, ...data } });
    return true;
  }

  private flush(p: Pending) { for (const e of p) this.events.emit(e.name, e.payload); }

  /** Pagamento confirmado por webhook ou consulta ativa (RN-14). Idempotente (RN-31). */
  /** Vínculo comprador↔afiliado (RN-70), gravado só com a compra paga, pelo prazo do cookie do produto. */
  private async bindAffiliateOnPaid(tx: any, order: { customer_id: string; affiliate_workspace_id: string | null; items: { kind: string; product_id: string }[] }) {
    if (!order.affiliate_workspace_id) return;
    const productId = order.items.find(i => i.kind === 'main')!.product_id;
    const product = await tx.products.findUniqueOrThrow({ where: { id: productId } });
    const affiliation = await tx.affiliations.findFirst({ where: { product_id: productId, affiliate_workspace_id: order.affiliate_workspace_id, status: 'active' } });
    if (!affiliation) return;
    const c = await tx.customers.findUniqueOrThrow({ where: { id: order.customer_id } });
    const expires_at = new Date(Date.now() + product.affiliate_cookie_days * 86400000);
    for (const key of [`doc:${c.document_hash}`, `email:${blindIndex(c.email)}`]) {
      await tx.affiliate_bindings.upsert({ where: { product_id_customer_key: { product_id: productId, customer_key: key } }, create: { product_id: productId, customer_key: key, affiliation_id: affiliation.id, expires_at }, update: { affiliation_id: affiliation.id, expires_at } });
    }
  }

  async markPaid(orderId: string, source: string) {
    const pending: Pending = [];
    await this.prisma.$transaction(async (tx) => {
      const [cur] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (!cur || POST_PAID.includes(cur.status)) return; // nunca regride / não processa 2x
      const order = await tx.orders.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, splits: true } });
      const offer = await tx.offers.findUniqueOrThrow({ where: { id: order.offer_id } });
      const paidAt = new Date();
      const guaranteeEnds = new Date(paidAt.getTime() + offer.guarantee_days * 86400000);
      const ok = await this.transition(tx, orderId, 'paid', 'payment.confirmed', { source }, pending);
      if (!ok) return;
      await tx.orders.update({ where: { id: orderId }, data: { paid_at: paidAt, guarantee_ends_at: guaranteeEnds } });
      await this.bindAffiliateOnPaid(tx, order);
      await tx.payments.updateMany({ where: { order_id: orderId, status: { in: ['pending', 'authorized', 'expired'] } }, data: { status: 'paid', raw_status: 'PAID' } });

      // Ledger: entrada no gateway (débito) e créditos congelados na venda (RN-06), com prazos (RN-35)
      const entries: Entry[] = [{ owner_type: 'gateway', owner_id: null, bucket: 'clearing', debit: order.total_cents, description: `Venda ${order.code}` }];
      const product = await tx.products.findUniqueOrThrow({ where: { id: order.items.find(i => i.kind === 'main')!.product_id } });
      const riskCfg = await this.risk.config();
      for (const s of order.splits) {
        if (s.amount_cents === 0n) continue;
        if (s.beneficiary_type === 'platform') {
          entries.push({ owner_type: 'platform', owner_id: null, bucket: 'balance', credit: s.amount_cents, description: `Taxa Domma — ${order.code}` });
          continue;
        }
        const label = s.beneficiary_type === 'producer' ? `Venda de ${product.name}` : s.beneficiary_type === 'affiliate' ? `Comissão de afiliado — ${product.name}` : `Sociedade em ${product.name}`;
        // reserva de segurança (conta nova ou definida no back-office): parte do valor fica "Chegando" por mais tempo
        const bws = await tx.workspaces.findUnique({ where: { id: s.beneficiary_id! }, select: { reserve_pct: true, reserve_days: true, created_at: true } });
        const res = bws ? reserveFor(bws, await tx.orders.count({ where: { workspace_id: s.beneficiary_id!, paid_at: { not: null } } }), riskCfg, paidAt) : null;
        let parts = releaseSchedule(s.amount_cents, order.method as Method, paidAt, guaranteeEnds);
        if (res) parts = applyReserve(parts, res.pct, res.days, paidAt);
        for (const part of parts) {
          entries.push({ owner_type: 'workspace', owner_id: s.beneficiary_id, bucket: 'balance', credit: part.amount, available_at: part.availableAt, description: `${label} (${order.code})` });
        }
      }
      await this.ledger.post(tx, { type: 'order', id: orderId }, entries);
      // antifraude: compra em revisão → dinheiro do produtor, afiliado e sócios fica "Em análise"
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'hold:' + orderId}))`;
      if (await tx.risk_assessments.count({ where: { order_id: orderId, review_status: 'open' } })) await this.ledger.holdOrder(tx, orderId, order.code);

      // Matrícula para cada item (RN-24, RN-32)
      for (const it of order.items) {
        await tx.enrollments.upsert({
          where: { order_item_id: it.id },
          create: { workspace_id: order.workspace_id, customer_id: order.customer_id, product_id: it.product_id, order_item_id: it.id, status: 'active' },
          update: { status: 'active' },
        });
      }
      // Assinatura: cria/renova ciclo
      if (offer.billing_type === 'subscription') {
        const pay = await tx.payments.findFirst({ where: { order_id: orderId }, orderBy: { created_at: 'desc' } });
        const months = { month: 1, quarter: 3, semester: 6, year: 12 }[offer.interval ?? 'month'];
        const end = new Date(paidAt); end.setMonth(end.getMonth() + months);
        if (order.subscription_id) {
          await tx.subscriptions.update({ where: { id: order.subscription_id }, data: { status: 'active', current_period_end: end, next_charge_at: end, retry_count: 0 } });
        } else {
          const sub = await tx.subscriptions.create({ data: { workspace_id: order.workspace_id, customer_id: order.customer_id, offer_id: offer.id, status: 'active', price_cents: offer.price_cents, card_token_ref: pay?.card_token_ref, card_brand: pay?.card_brand, card_last4: pay?.card_last4, current_period_end: end, next_charge_at: end } });
          await tx.orders.update({ where: { id: orderId }, data: { subscription_id: sub.id } });
        }
      }
      await tx.checkout_leads.updateMany({ where: { offer_id: order.offer_id, email: (await tx.customers.findUniqueOrThrow({ where: { id: order.customer_id } })).email }, data: { converted_at: paidAt } });
    });
    this.flush(pending);
  }

  async markExpired(orderId: string) {
    const pending: Pending = [];
    await this.prisma.$transaction(async (tx) => {
      const ok = await this.transition(tx, orderId, 'expired', 'payment.expired', {}, pending);
      if (ok) await tx.payments.updateMany({ where: { order_id: orderId, status: 'pending' }, data: { status: 'expired', raw_status: 'EXPIRED' } });
    });
    this.flush(pending);
  }

  /** Reembolso (RN-50..53, seção 8.5). */
  async refund(orderId: string, by: 'customer' | 'producer' | 'platform', opts: { reason?: string; actorId?: string; customerId?: string; workspaceId?: string }) {
    const order = await this.prisma.orders.findUnique({ where: { id: orderId }, include: { payments: { orderBy: { created_at: 'desc' } } } });
    if (!order) throw new AppError('NOT_FOUND');
    if (by === 'customer' && order.customer_id !== opts.customerId) throw new AppError('NOT_FOUND');
    if (by === 'producer' && order.workspace_id !== opts.workspaceId) throw new AppError('NOT_FOUND');
    if (order.status === 'refund_requested' || order.status === 'refunded') throw new AppError('REFUND_ALREADY_REQUESTED');
    if (order.status !== 'paid') throw new AppError('VALIDATION_ERROR', { title: 'Esta compra não pode ser reembolsada.' });
    if (by === 'customer' && (!order.guarantee_ends_at || order.guarantee_ends_at < new Date())) throw new AppError('REFUND_WINDOW_CLOSED');
    const pay = order.payments.find(p => p.status === 'paid');
    if (!pay) throw new AppError('VALIDATION_ERROR');

    const pending: Pending = [];
    const refund = await this.prisma.$transaction(async (tx) => {
      const ok = await this.transition(tx, orderId, 'refund_requested', 'refund.requested', { by, reason: opts.reason }, pending);
      if (!ok) throw new AppError('REFUND_ALREADY_REQUESTED');
      return tx.refunds.create({ data: { order_id: orderId, requested_by: by, reason: opts.reason, amount_cents: order.total_cents } });
    });
    this.flush(pending);
    if (by !== 'customer') await this.audit.log({ actorId: opts.actorId, action: 'order.refund', target: `order:${orderId}`, reason: opts.reason ?? null });

    try {
      const r = await this.gateway.refund({ chargeId: pay.provider_charge_id, amountCents: order.total_cents, idempotencyKey: `refund:${refund.id}` });
      await this.prisma.refunds.update({ where: { id: refund.id }, data: { provider_refund_id: r.refundId } });
      if (r.status === 'done') await this.finalizeRefund(orderId, refund.id);
    } catch (e) {
      this.log.error(`falha no reembolso ${orderId}: ${(e as Error).message}`);
      const p2: Pending = [];
      await this.prisma.$transaction(async (tx) => {
        await tx.refunds.update({ where: { id: refund.id }, data: { status: 'failed' } });
        await this.transition(tx, orderId, 'paid', 'refund.failed', {}, p2);
      });
      throw new AppError('INTERNAL_ERROR');
    }
    return { refund_id: refund.id, status: 'processing', method: order.method, estimated_days: order.method === 'pix' ? 1 : order.method === 'card' ? 60 : 3 };
  }

  async finalizeRefund(orderId: string, refundId?: string) {
    const pending: Pending = [];
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.orders.findUniqueOrThrow({ where: { id: orderId } });
      const ok = await this.transition(tx, orderId, 'refunded', 'refund.done', {}, pending);
      if (!ok) return;
      const ref = { type: 'refund', id: refundId ?? orderId };
      // valor em análise de segurança volta ao saldo antes de ser revertido; a revisão se encerra
      await this.ledger.releaseOrderHold(tx, orderId, order.code, `Fim da análise (reembolso) — ${order.code}`);
      await tx.risk_assessments.updateMany({ where: { order_id: orderId, review_status: 'open' }, data: { review_status: 'closed', reviewed_at: new Date(), review_reason: 'Pedido reembolsado' } });
      // divisão revertida na mesma proporção (RN-53), incluindo a taxa Domma (RN-52)
      await this.ledger.reverseOrderCredits(tx, orderId, { ref, owners: ['workspace', 'platform'], description: (e) => e.owner_type === 'platform' ? `Estorno de taxa — ${order.code}` : `Reembolso — ${order.code}` });
      // custo do gateway não é devolvido ao produtor (RN-52)
      const cost = gatewayCost(order.method as Method, order.total_cents);
      await this.ledger.post(tx, ref, [
        { owner_type: 'workspace', owner_id: order.workspace_id, bucket: 'balance', debit: cost, description: `Custo de processamento do reembolso — ${order.code}` },
        { owner_type: 'platform', owner_id: null, bucket: 'balance', credit: cost, description: `Custo de gateway repassado — ${order.code}` },
      ]);
      await tx.orders.update({ where: { id: orderId }, data: { refunded_at: new Date() } });
      await tx.order_items.updateMany({ where: { order_id: orderId }, data: { status: 'refunded' } });
      const items = await tx.order_items.findMany({ where: { order_id: orderId } });
      await tx.enrollments.updateMany({ where: { order_item_id: { in: items.map(i => i.id) } }, data: { status: 'revoked' } }); // RN-33
      if (refundId) await tx.refunds.update({ where: { id: refundId }, data: { status: 'done' } });
      if (order.subscription_id) await tx.subscriptions.update({ where: { id: order.subscription_id }, data: { status: 'canceled', next_charge_at: null, ended_at: new Date(), end_reason: 'refund' } });
    });
    this.flush(pending);
  }

  /** Contestação (RN-54, seção 8.5). */
  async chargeback(orderId: string, stage: 'opened' | 'won' | 'lost') {
    const pending: Pending = [];
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.orders.findUniqueOrThrow({ where: { id: orderId } });
      if (stage === 'opened') {
        if (!(await this.transition(tx, orderId, 'chargeback', 'chargeback.opened', {}, pending))) return;
        await this.ledger.releaseOrderHold(tx, orderId, order.code, `Fim da análise (contestação) — ${order.code}`);
        await tx.risk_assessments.updateMany({ where: { order_id: orderId, review_status: 'open' }, data: { review_status: 'closed', reviewed_at: new Date(), review_reason: 'Cliente contestou a compra' } });
        await this.ledger.reverseOrderCredits(tx, orderId, { ref: { type: 'chargeback', id: orderId }, owners: ['workspace'], toBlocked: true, description: () => `Cliente contestou a compra ${order.code}` });
        const items = await tx.order_items.findMany({ where: { order_id: orderId } });
        await tx.enrollments.updateMany({ where: { order_item_id: { in: items.map(i => i.id) } }, data: { status: 'suspended' } });
        return;
      }
      const blocked = await tx.ledger_entries.groupBy({ by: ['owner_id'], where: { reference_type: 'chargeback', reference_id: orderId, bucket: 'blocked' }, _sum: { credit_cents: true, debit_cents: true } });
      const to: OrderStatus = stage === 'won' ? 'chargeback_won' : 'chargeback_lost';
      if (!(await this.transition(tx, orderId, to, `chargeback.${stage}`, {}, pending))) return;
      const entries: Entry[] = [];
      let total = 0n;
      for (const b of blocked) {
        const amt = (b._sum.credit_cents ?? 0n) - (b._sum.debit_cents ?? 0n);
        if (amt <= 0n) continue;
        total += amt;
        entries.push({ owner_type: 'workspace', owner_id: b.owner_id, bucket: 'blocked', debit: amt, description: stage === 'won' ? `Contestação ganha — ${order.code}` : `Contestação perdida — ${order.code}` });
        if (stage === 'won') entries.push({ owner_type: 'workspace', owner_id: b.owner_id, bucket: 'balance', credit: amt, description: `Contestação ganha — valor liberado (${order.code})` });
      }
      if (stage === 'lost') {
        // portador recebe o total de volta; a parcela da plataforma é debitada do produtor
        const platform = (await tx.splits.findFirst({ where: { order_id: orderId, beneficiary_type: 'platform' } }))?.amount_cents ?? 0n;
        entries.push({ owner_type: 'workspace', owner_id: order.workspace_id, bucket: 'balance', debit: platform, description: `Taxas da compra contestada — ${order.code}` });
        entries.push({ owner_type: 'gateway', owner_id: null, bucket: 'clearing', credit: total + platform, description: `Devolução ao portador — ${order.code}` });
        const items = await tx.order_items.findMany({ where: { order_id: orderId } });
        await tx.enrollments.updateMany({ where: { order_item_id: { in: items.map(i => i.id) } }, data: { status: 'revoked' } });
      } else {
        const items = await tx.order_items.findMany({ where: { order_id: orderId } });
        await tx.enrollments.updateMany({ where: { order_item_id: { in: items.map(i => i.id) } }, data: { status: 'active' } });
      }
      if (entries.length) await this.ledger.post(tx, { type: 'chargeback', id: orderId }, entries);
    });
    this.flush(pending);
  }
}
