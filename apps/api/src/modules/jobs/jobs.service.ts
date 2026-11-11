import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue.service';
import { NotifyService, render } from '../../infra/notify.service';
import { OrdersService } from '../orders/orders.service';
import { GATEWAY, GatewayAdapter, GatewayEvent } from '../gateway/gateway.types';
import { PrivacyService } from '../privacy/privacy.service';
import { RiskService } from '../risk/risk.service';
import { gatewaySplit } from '../gateway/split';
import { decrypt, blindIndex, hmacSign, randomToken, signToken } from '../../common/crypto';
import { formatBRL, tierBpsFor } from '../../domain/money';
import { maskEmail } from '../../domain/validators';
import { urls } from '../../common/urls';
import { FinanceService } from '../finance/finance.service';
import { safePost } from '../integrations/ssrf';

const RETRY_MIN = [1, 5, 30, 120, 360, 1440]; // 22.7

/**
 * Trabalhos assíncronos (filas) e reações a eventos de domínio (seção 6.3):
 * webhooks de entrada, expiração de Pix, régua de recuperação, avisos, webhooks do produtor,
 * cobrança de assinaturas, faixas de taxa e conciliação.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private log = new Logger('Jobs');
  constructor(
    private prisma: PrismaService, private queue: QueueService, private notify: NotifyService,
    private orders: OrdersService, private finance: FinanceService, @Inject(GATEWAY) private gateway: GatewayAdapter,
    private privacy: PrivacyService, private risk: RiskService,
  ) {}

  async onApplicationBootstrap() {
    const q = this.queue;
    q.register('webhook.in', (d) => this.processWebhook(d.id));
    q.register('pix.expire', (d) => this.expirePix(d.orderId));
    q.register('recovery.start', (d) => this.startRecovery(d.orderId, d.kind));
    q.register('recovery.send', (d) => this.sendRecovery(d));
    q.register('abandoned.check', (d) => this.checkAbandoned(d.leadId));
    q.register('producer.webhook', (d) => this.deliverWebhook(d.deliveryId));
    q.register('subscriptions.charge', () => this.chargeSubscriptions());
    q.register('fees.tiers', () => this.recomputeTiers());
    q.register('reconcile.daily', () => this.reconcile());
    q.register('transfers.poll', () => this.pollTransfers());
    q.register('privacy.due', async () => { await this.privacy.runDue(); });
    q.register('risk.producers', async () => { await this.risk.scanProducers(); await this.risk.scanMarketplace(); }); // RN-55 + vitrine
    q.register('withdrawal.retry', (d: { id: string; attempt: number }) => this.finance.retryTransfer(d.id, d.attempt));
    q.startWorker();
    if (process.env.DISABLE_CRON !== '1') {
      await q.repeat('subscriptions.charge', '15 * * * *');
      await q.repeat('fees.tiers', '0 3 * * *'); // RN-05: diariamente às 03:00
      await q.repeat('reconcile.daily', '30 4 * * *');
      await q.repeat('risk.producers', '45 5 * * *'); // chargeback do produtor: alerta, revisão e pausa de saques
      await q.repeat('privacy.due', '15 5 * * *'); // LGPD: anonimiza quem pediu exclusão quando vence o prazo legal
      if (this.gateway.getTransfer) await q.repeat('transfers.poll', '*/10 * * * *'); // gateways sem webhook de transferência
    }
  }

  // ───────── Webhooks do gateway ─────────
  async processWebhook(rowId: string) {
    const row = await this.prisma.webhook_events_in.findUniqueOrThrow({ where: { id: rowId } });
    if (row.processed_at) return;
    const ev = row.payload as unknown as GatewayEvent;
    try {
      if ('chargeId' in ev) {
        const pay = await this.prisma.payments.findUnique({ where: { provider_charge_id: ev.chargeId } });
        if (!pay) throw new Error('cobrança desconhecida');
        if (ev.type === 'charge.paid') {
          // RN-14: confirma também por consulta ativa antes de liberar
          const live = await this.gateway.getCharge(ev.chargeId);
          if (!live || live.status !== 'paid') throw new Error(`consulta ativa divergente: ${live?.status ?? 'cobrança não encontrada no gateway'}`);
          await this.prisma.payments.update({ where: { id: pay.id }, data: { status: 'paid', raw_status: 'PAID' } });
          await this.orders.markPaid(pay.order_id, `webhook:${row.event_id}`);
        } else if (ev.type === 'charge.expired') await this.orders.markExpired(pay.order_id);
        else if (ev.type === 'charge.refunded') await this.orders.finalizeRefund(pay.order_id);
        else if (ev.type === 'charge.chargeback') await this.orders.chargeback(pay.order_id, 'opened');
        else if (ev.type === 'charge.chargeback_won') await this.orders.chargeback(pay.order_id, 'won');
        else if (ev.type === 'charge.chargeback_lost') await this.orders.chargeback(pay.order_id, 'lost');
      } else if (ev.type === 'transfer.paid' || ev.type === 'transfer.failed') {
        await this.finance.onTransfer(ev.transferId, ev.type === 'transfer.paid', (ev as any).reason);
      }
      await this.prisma.webhook_events_in.update({ where: { id: rowId }, data: { processed_at: new Date(), error: null } });
    } catch (e) {
      await this.prisma.webhook_events_in.update({ where: { id: rowId }, data: { error: String((e as Error).message).slice(0, 500) } });
      throw e;
    }
  }

  async expirePix(orderId: string) {
    const last = await this.prisma.payments.findFirst({ where: { order_id: orderId }, orderBy: { created_at: 'desc' } });
    if (!last || last.status !== 'pending' || !last.pix_expires_at || last.pix_expires_at > new Date()) return;
    await this.orders.markExpired(orderId);
  }

  // ───────── Régua de recuperação (RN-40..42) ─────────
  async startRecovery(orderId: string, kind: 'pix_unpaid' | 'boleto_unpaid' | 'card_declined') {
    const o = await this.prisma.orders.findUnique({ where: { id: orderId } });
    if (!o) return;
    const s = await this.recoverySettings(o.workspace_id);
    const on = { pix_unpaid: s.pix_unpaid, boleto_unpaid: s.boleto_unpaid, card_declined: s.card_declined }[kind];
    if (!on) return;
    for (let step = 0; step < Math.min(3, s.delays_min.length); step++) {
      await this.queue.addDelayed('recovery.send', { orderId, kind, step }, s.delays_min[step] * 60_000, `rec:${orderId}:${step}`);
    }
  }

  private async recoverySettings(workspaceId: string) {
    return (await this.prisma.recovery_settings.findUnique({ where: { workspace_id: workspaceId } })) ?? { pix_unpaid: true, boleto_unpaid: true, card_declined: true, abandoned: true, email: true, whatsapp: true, delays_min: [15, 120, 1440], template: '{nome}, seu pedido de {produto} ainda está esperando. Termine aqui: {link}' };
  }

  async sendRecovery(d: { orderId?: string; leadId?: string; kind: string; step: number }) {
    let email: string, phone: string | null = null, name: string, productName: string, link: string, workspaceId: string, wsName: string;
    if (d.orderId) {
      const o = await this.prisma.orders.findUnique({ where: { id: d.orderId }, include: { items: true } });
      if (!o || ['paid', 'refund_requested', 'refunded', 'chargeback', 'chargeback_won', 'chargeback_lost'].includes(o.status)) return; // para se pago
      // comprador já pagou outro pedido da mesma oferta?
      const paidOther = await this.prisma.orders.count({ where: { customer_id: o.customer_id, offer_id: o.offer_id, status: 'paid' } });
      if (paidOther) return;
      const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
      const offer = await this.prisma.offers.findUniqueOrThrow({ where: { id: o.offer_id }, include: { product: { include: { workspace: true } } } });
      email = c.email; phone = decrypt(c.phone_enc); name = c.name; productName = offer.product.name; workspaceId = o.workspace_id; wsName = offer.product.workspace.name;
      link = o.method === 'pix' ? urls.pix(o.id, new Date(Date.now() + 86400000)) : `${urls.checkout(offer.slug)}?email=${encodeURIComponent(c.email)}`;
    } else {
      const l = await this.prisma.checkout_leads.findUnique({ where: { id: d.leadId! } });
      if (!l || l.converted_at) return;
      const offer = await this.prisma.offers.findUniqueOrThrow({ where: { id: l.offer_id }, include: { product: { include: { workspace: true } } } });
      email = l.email; phone = l.phone_enc ? decrypt(l.phone_enc) : null; name = l.name || ''; productName = offer.product.name; workspaceId = l.workspace_id; wsName = offer.product.workspace.name;
      link = `${urls.checkout(offer.slug)}?email=${encodeURIComponent(l.email)}`;
    }
    const s = await this.recoverySettings(workspaceId);
    const optedOut = await this.prisma.opt_outs.findFirst({ where: { key_hash: { in: [blindIndex(email), ...(phone ? [blindIndex(phone)] : [])] } } });
    if (optedOut) return;
    const first = name.split(' ')[0] || 'Olá';
    const unsubscribe = `${process.env.APP_URL}/descadastro?t=${signToken({ e: email, exp: Date.now() + 90 * 86400000 })}`;
    const texto = render(s.template, { nome: first, produto: productName, link });
    if (s.email) await this.notify.send({ channel: 'email', to: email, template: 'recovery', workspaceId, refType: d.orderId ? 'order' : 'lead', refId: d.orderId ?? d.leadId, vars: { produtor: wsName, texto, descadastro: unsubscribe } });
    if (s.whatsapp && phone && d.kind === 'pix_unpaid') await this.notify.send({ channel: 'whatsapp', to: phone, template: 'pix_unpaid', workspaceId, refType: 'order', refId: d.orderId, vars: { primeiro_nome: first, produto: productName, link } });
  }

  async checkAbandoned(leadId: string) {
    const l = await this.prisma.checkout_leads.findUnique({ where: { id: leadId } });
    if (!l || l.converted_at) return;
    if (Date.now() - l.updated_at.getTime() < 29 * 60_000) return; // RN-41: 30 min sem compra
    const buyer = await this.prisma.customers.findUnique({ where: { email: l.email } });
    if (buyer && (await this.prisma.orders.count({ where: { offer_id: l.offer_id, customer_id: buyer.id, created_at: { gte: l.created_at } } }))) return; // virou pedido (régua de pedido assume)
    const s = await this.recoverySettings(l.workspace_id);
    if (!s.abandoned) return;
    for (let step = 0; step < Math.min(3, s.delays_min.length); step++) {
      await this.queue.addDelayed('recovery.send', { leadId, kind: 'abandoned', step }, step === 0 ? 0 : (s.delays_min[step] - s.delays_min[0]) * 60_000, `recl:${leadId}:${step}`);
    }
  }

  // ───────── Reações a eventos de domínio ─────────
  @OnEvent('order.paid', { async: true })
  async onPaid(e: { orderId: string }) {
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id: e.orderId }, include: { items: true, splits: true } });
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    const product = await this.prisma.products.findUniqueOrThrow({ where: { id: o.items.find(i => i.kind === 'main')!.product_id }, include: { workspace: true } });
    const ws = product.workspace;
    const first = c.name.split(' ')[0];
    const contato = ws.support_whatsapp || ws.support_email || 'pela sua área de cliente';
    const vars = { primeiro_nome: first, produto: product.name, link_acesso: urls.customerArea(), produtor: ws.name, contato };
    await this.notify.send({ channel: 'email', to: c.email, template: 'purchase_approved', workspaceId: ws.id, refType: 'order', refId: o.id, vars });
    await this.notify.send({ channel: 'whatsapp', to: decrypt(c.phone_enc), template: 'purchase_approved', workspaceId: ws.id, refType: 'order', refId: o.id, vars });
    const owner = await this.prisma.users.findUniqueOrThrow({ where: { id: ws.owner_id } });
    const net = o.splits.find(s => s.beneficiary_type === 'producer')?.amount_cents ?? 0n;
    await this.notify.send({ channel: 'push', to: owner.email, template: 'sale_approved', workspaceId: ws.id, refType: 'order', refId: o.id, vars: { comprador: c.name, produto: product.name, valor: formatBRL(o.total_cents), liquido: formatBRL(net) } });
    await this.emitProducerWebhook(ws.id, 'order.paid', o, c);
    if (o.affiliate_workspace_id) {
      const aff = o.splits.find(s => s.beneficiary_type === 'affiliate');
      await this.emitProducerWebhook(ws.id, 'affiliate.commission', o, c, { affiliate_amount: Number(aff?.amount_cents ?? 0) });
    }
    void this.sendConversionsApi(o.id);
  }

  @OnEvent('order.refund_requested', { async: true })
  async onRefundRequested(e: { orderId: string; by: string }) {
    if (e.by !== 'customer') return;
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id: e.orderId }, include: { items: true } });
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    const product = await this.prisma.products.findUniqueOrThrow({ where: { id: o.items.find(i => i.kind === 'main')!.product_id }, include: { workspace: true } });
    const owner = await this.prisma.users.findUniqueOrThrow({ where: { id: product.workspace.owner_id } });
    await this.notify.send({ channel: 'email', to: owner.email, template: 'refund_requested', workspaceId: o.workspace_id, refType: 'order', refId: o.id, vars: { comprador: c.name, produto: product.name, valor: formatBRL(o.total_cents) } });
  }

  @OnEvent('order.refunded', { async: true })
  async onRefunded(e: { orderId: string }) {
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id: e.orderId }, include: { items: true } });
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    const product = await this.prisma.products.findUniqueOrThrow({ where: { id: o.items.find(i => i.kind === 'main')!.product_id }, include: { workspace: true } });
    const prazo = { pix: 'O dinheiro volta para a sua conta em até 1 dia útil', card: 'O estorno aparece na fatura do seu cartão em até 2 faturas, conforme o banco', boleto: 'Enviaremos o valor para a chave Pix informada' }[o.method];
    await this.notify.send({ channel: 'email', to: c.email, template: 'refund_confirmed', workspaceId: o.workspace_id, refType: 'order', refId: o.id, vars: { produtor: product.workspace.name, valor: formatBRL(o.total_cents), produto: product.name, prazo_por_meio: prazo } });
    await this.emitProducerWebhook(o.workspace_id, 'order.refunded', o, c);
  }

  @OnEvent('order.chargeback', { async: true })
  async onChargeback(e: { orderId: string }) {
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id: e.orderId } });
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: o.workspace_id } });
    const owner = await this.prisma.users.findUniqueOrThrow({ where: { id: ws.owner_id } });
    await this.notify.send({ channel: 'email', to: owner.email, template: 'chargeback_opened', workspaceId: ws.id, refType: 'order', refId: o.id, vars: { codigo: o.code, valor: formatBRL(o.total_cents) } });
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    await this.emitProducerWebhook(ws.id, 'order.chargeback', o, c);
  }

  @OnEvent('order.pending', { async: true })
  async onPending(e: { orderId: string }) {
    const o = await this.prisma.orders.findUnique({ where: { id: e.orderId } });
    if (!o) return;
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    await this.emitProducerWebhook(o.workspace_id, o.method === 'pix' ? 'pix.generated' : 'boleto.generated', o, c);
  }

  /** Pixel Meta via Conversions API, com o mesmo event_id do navegador (seção 5.8). */
  private async sendConversionsApi(orderId: string) {
    const o = await this.prisma.orders.findUnique({ where: { id: orderId } });
    const offer = o && (await this.prisma.offers.findUnique({ where: { id: o.offer_id } }));
    const pixels = (offer?.theme as any)?.pixels;
    if (!o || !pixels?.meta_pixel_id || !pixels?.meta_capi_token) return;
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    const { createHash } = await import('node:crypto');
    const h = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
    await fetch(`https://graph.facebook.com/v19.0/${pixels.meta_pixel_id}/events?access_token=${pixels.meta_capi_token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [{ event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: `purchase_${o.id}`, action_source: 'website', user_data: { em: [h(c.email)], ph: [h(decrypt(c.phone_enc))] }, custom_data: { currency: 'BRL', value: Number(o.total_cents) / 100 } }] }),
    }).catch(() => {});
  }

  // ───────── Webhooks para o produtor (9.3 / 22.7) ─────────
  async emitProducerWebhook(workspaceId: string, type: string, o: { id: string; total_cents: bigint; method: string; code: string }, c: { name: string; email: string }, extra: Record<string, unknown> = {}) {
    const endpoints = await this.prisma.webhook_endpoints.findMany({ where: { workspace_id: workspaceId, active: true, events: { has: type } } });
    if (!endpoints.length) return;
    const parts = c.name.split(' ');
    const payload = { id: `evt_${randomToken(12)}`, type, created_at: new Date().toISOString(), data: { order_id: o.id, code: o.code, amount: Number(o.total_cents), method: o.method, customer: { name: `${parts[0]} ${parts[1]?.[0] ?? ''}.`.trim(), email: maskEmail(c.email) }, ...extra } };
    for (const ep of endpoints) {
      const d = await this.prisma.webhook_deliveries.create({ data: { endpoint_id: ep.id, event_id: payload.id, event_type: type, payload } });
      await this.queue.add('producer.webhook', { deliveryId: d.id }, { attempts: 1 });
    }
  }

  async deliverWebhook(deliveryId: string) {
    const d = await this.prisma.webhook_deliveries.findUnique({ where: { id: deliveryId } });
    if (!d || d.delivered_at) return;
    const ep = await this.prisma.webhook_endpoints.findUniqueOrThrow({ where: { id: d.endpoint_id } });
    if (!ep.active) return;
    const body = JSON.stringify(d.payload);
    const t = Math.floor(Date.now() / 1000);
    const sig = hmacSign(`${t}.${body}`, decrypt(ep.secret_enc));
    let status: number | null = null, error: string | null = null;
    try {
      // SSRF (11.5): o IP é checado na própria conexão, sem seguir redirecionamento
      const r = await safePost(ep.url, { 'Content-Type': 'application/json', 'User-Agent': 'DommaMart-Webhooks/1.0', 'X-DommaMart-Signature': `t=${t},v1=${sig}` }, body, 10_000);
      status = r.status;
      if (r.status < 200 || r.status >= 300) error = `HTTP ${r.status}`;
    } catch (e) { error = String((e as Error).message).slice(0, 300); }
    const attempts = d.attempts + 1;
    if (!error) {
      await this.prisma.webhook_deliveries.update({ where: { id: d.id }, data: { attempts, last_status: status, last_error: null, delivered_at: new Date(), next_attempt_at: null } });
      return;
    }
    if (attempts > RETRY_MIN.length) {
      await this.prisma.webhook_deliveries.update({ where: { id: d.id }, data: { attempts, last_status: status, last_error: error, next_attempt_at: null } });
      await this.prisma.webhook_endpoints.update({ where: { id: ep.id }, data: { active: false, disabled_at: new Date() } });
      const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: ep.workspace_id } });
      const owner = await this.prisma.users.findUniqueOrThrow({ where: { id: ws.owner_id } });
      await this.notify.send({ channel: 'email', to: owner.email, template: 'recovery', workspaceId: ws.id, vars: { produtor: 'Domma Mart', texto: `Desativamos seu webhook ${ep.url} depois de várias falhas de entrega. Confira em Configurações › Integrações.`, descadastro: '' } });
      return;
    }
    const delay = RETRY_MIN[attempts - 1] * 60_000;
    await this.prisma.webhook_deliveries.update({ where: { id: d.id }, data: { attempts, last_status: status, last_error: error, next_attempt_at: new Date(Date.now() + delay) } });
    await this.queue.addDelayed('producer.webhook', { deliveryId: d.id }, delay, `whd:${d.id}:${attempts}`);
  }

  // ───────── Assinaturas (RN-45..48) ─────────
  async chargeSubscriptions() {
    const due = await this.prisma.subscriptions.findMany({ where: { status: { in: ['active', 'past_due'] }, next_charge_at: { lte: new Date() } }, take: 200 });
    for (const s of due) {
      if (s.cancel_at_period_end) {
        await this.prisma.subscriptions.update({ where: { id: s.id }, data: { status: 'canceled', next_charge_at: null } });
        await this.revokeSubscriptionAccess(s.id, 'expired');
        continue;
      }
      await this.renewSubscription(s.id).catch(e => this.log.error(`renovação ${s.id}: ${e.message}`));
    }
  }

  async renewSubscription(subId: string) {
    const s = await this.prisma.subscriptions.findUniqueOrThrow({ where: { id: subId } });
    const offer = await this.prisma.offers.findUniqueOrThrow({ where: { id: s.offer_id }, include: { product: { include: { workspace: true } } } });
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: s.customer_id } });
    const first = await this.prisma.orders.findFirstOrThrow({ where: { subscription_id: s.id }, orderBy: { created_at: 'asc' }, include: { splits: true, items: true } });
    // divisão da renovação: mesma proporção do primeiro pedido, enviada ao gateway com as subcontas
    const { orderCode } = await import('../../common/crypto');
    const ratio = (v: bigint) => (v * s.price_cents) / first.total_cents;
    const splits = first.splits.map(sp => ({ beneficiary_type: sp.beneficiary_type, beneficiary_id: sp.beneficiary_id, amount_cents: ratio(sp.amount_cents), rule: sp.rule as any }));
    const diff = s.price_cents - splits.reduce((a, b) => a + b.amount_cents, 0n);
    splits.find(x => x.beneficiary_type === 'producer')!.amount_cents += diff;
    const charge = await this.gateway.createCharge({
      idempotencyKey: `sub:${s.id}:${s.current_period_end.getTime()}:${s.retry_count}`, orderId: s.id, method: 'card', amountCents: s.price_cents, installments: 1,
      description: offer.product.name, customer: { name: c.name, email: c.email, document: decrypt(c.document_enc), phone: decrypt(c.phone_enc) },
      savedCardRef: s.card_token_ref ?? undefined,
      split: await gatewaySplit(this.prisma, splits),
    });
    if (charge.status === 'declined') {
      const retry = s.retry_count + 1;
      const next = [1, 3, 5][s.retry_count]; // D+1, D+3, D+5
      if (next == null) {
        await this.prisma.subscriptions.update({ where: { id: s.id }, data: { status: 'defaulted', next_charge_at: null } });
        await this.revokeSubscriptionAccess(s.id, 'suspended');
      } else {
        await this.prisma.subscriptions.update({ where: { id: s.id }, data: { status: 'past_due', retry_count: retry, next_charge_at: new Date(Date.now() + next * 86400000) } });
      }
      await this.notify.send({ channel: 'email', to: c.email, template: 'subscription_failed', workspaceId: s.workspace_id, vars: { produtor: offer.product.workspace.name, produto: offer.product.name, link: urls.customerArea() } });
      return;
    }
    const order = await this.prisma.orders.create({ data: {
      code: orderCode(), workspace_id: s.workspace_id, customer_id: s.customer_id, offer_id: s.offer_id, status: 'pending', method: 'card', installments: 1,
      subtotal_cents: s.price_cents, total_cents: s.price_cents, subscription_id: s.id, ip_hash: first.ip_hash, user_agent: 'renewal', idempotency_key: `renew:${s.id}:${s.current_period_end.getTime()}`,
      items: { create: [{ product_id: offer.product_id, offer_id: offer.id, kind: 'main', price_cents: s.price_cents }] }, splits: { create: splits },
    } });
    await this.prisma.payments.create({ data: { order_id: order.id, provider: this.gateway.name, provider_charge_id: charge.chargeId, method: 'card', status: charge.status, raw_status: charge.rawStatus, card_brand: s.card_brand, card_last4: s.card_last4 } });
    // matrícula segue a original: estende validade
    await this.notify.send({ channel: 'email', to: c.email, template: 'subscription_renewed', workspaceId: s.workspace_id, vars: { produtor: offer.product.workspace.name, produto: offer.product.name, valor: formatBRL(s.price_cents), final: s.card_last4 ?? '', data: s.current_period_end.toLocaleDateString('pt-BR') } });
  }

  private async revokeSubscriptionAccess(subId: string, status: 'suspended' | 'expired') {
    const orders = await this.prisma.orders.findMany({ where: { subscription_id: subId }, include: { items: true } });
    await this.prisma.enrollments.updateMany({ where: { order_item_id: { in: orders.flatMap(o => o.items.map(i => i.id)) } }, data: { status } });
  }

  // ───────── Faixas de taxa (RN-05) e conciliação (5.4) ─────────
  async recomputeTiers() {
    const rows = await this.prisma.$queryRaw<{ workspace_id: string; s: bigint }[]>(Prisma.sql`
      SELECT workspace_id, SUM(total_cents)::bigint s FROM orders WHERE status='paid' AND paid_at > now() - interval '30 days' GROUP BY workspace_id`);
    for (const r of rows) {
      const ws = await this.prisma.workspaces.findUnique({ where: { id: r.workspace_id } });
      const bps = tierBpsFor(r.s, ws?.custom_fee_bps);
      if (bps == null) { await this.prisma.fee_tiers_cache.deleteMany({ where: { workspace_id: r.workspace_id } }); continue; }
      await this.prisma.fee_tiers_cache.upsert({ where: { workspace_id: r.workspace_id }, create: { workspace_id: r.workspace_id, revenue_30d: r.s, fee_bps: bps, computed_at: new Date() }, update: { revenue_30d: r.s, fee_bps: bps, computed_at: new Date() } });
    }
  }

  /** Consulta saques em andamento nos gateways que não avisam por webhook (ex.: Pagar.me). */
  async pollTransfers() {
    if (!this.gateway.getTransfer) return;
    const pending = await this.prisma.withdrawals.findMany({ where: { status: 'processing', provider_transfer_id: { not: null } }, take: 200, orderBy: { created_at: 'asc' } });
    for (const w of pending) {
      try {
        const t = await this.gateway.getTransfer(w.provider_transfer_id!);
        if (t.status !== 'processing') await this.finance.onTransfer(w.provider_transfer_id!, t.status === 'paid', t.reason);
      } catch (e) { this.log.warn(`transferência ${w.provider_transfer_id}: ${(e as Error).message}`); }
    }
  }

  async reconcile() {
    const day = new Date(Date.now() - 86400000);
    const statement = await this.gateway.settlements(day);
    const [ours] = await this.prisma.$queryRaw<{ d: bigint; c: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(debit_cents),0)::bigint d, COALESCE(SUM(credit_cents),0)::bigint c FROM ledger_entries
      WHERE owner_type='gateway' AND created_at >= date_trunc('day', ${day}::timestamptz) AND created_at < date_trunc('day', ${day}::timestamptz) + interval '1 day'`);
    const theirs = statement.reduce((s, x) => s + (x.type === 'credit' ? x.amountCents : -x.amountCents), 0n);
    const diff = (ours.d - ours.c) - theirs;
    if (statement.length && diff !== 0n) this.log.error(`CONCILIAÇÃO: divergência de ${diff} centavos em ${day.toISOString().slice(0, 10)}`);
  }
}
