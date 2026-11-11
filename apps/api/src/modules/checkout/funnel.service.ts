import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { AppError } from '../../common/errors';
import { computeFee, computeSplit, installmentPlan, installmentOptions, formatBRL } from '../../domain/money';
import { decrypt, orderCode } from '../../common/crypto';
import { QueueService } from '../../infra/queue.service';
import { NotifyService } from '../../infra/notify.service';
import { urls } from '../../common/urls';
import { CheckoutService } from './checkout.service';

/** Por quanto tempo depois do pagamento a oferta de upsell fica disponível na página de obrigado. */
export const FUNNEL_WINDOW_MS = 30 * 60_000;
type Step = 'upsell' | 'downsell';

/**
 * Funil pós-compra (Fase 2): na página de obrigado, o comprador recebe uma oferta (upsell) e compra com 1 clique,
 * sem digitar nada de novo. Se recusar, pode ver uma segunda oferta (downsell, normalmente mais barata).
 *
 * Regras:
 * - só na compra que abriu o funil (pedido pago, sem pai), até 30 min depois do pagamento e com o token da página de obrigado;
 * - no máximo um pedido de upsell e um de downsell por compra (índice único parent_order_id + funnel_step);
 * - cartão: cobra o mesmo cartão da compra (referência do gateway, sem 3-D Secure de novo); Pix: gera um Pix novo;
 * - o afiliado da compra só leva comissão se também for afiliado ativo do produto do upsell;
 * - pedidos do funil não abrem outro funil.
 */
@Injectable()
export class FunnelService {
  private log = new Logger('Funnel');
  constructor(
    private prisma: PrismaService,
    @Inject(GATEWAY) private gateway: GatewayAdapter,
    private queue: QueueService,
    private notify: NotifyService,
    private checkout: CheckoutService,
  ) {}

  private async load(parentId: string) {
    const parent = await this.prisma.orders.findUnique({ where: { id: parentId }, include: { payments: { orderBy: { created_at: 'desc' }, take: 1 } } });
    if (!parent) throw new AppError('NOT_FOUND');
    const children = await this.prisma.orders.findMany({ where: { parent_order_id: parentId }, include: { payments: { orderBy: { created_at: 'desc' }, take: 1 } } });
    const declined = await this.prisma.order_events.findMany({ where: { order_id: parentId, event: { in: ['funnel.upsell_declined', 'funnel.downsell_declined'] } } });
    const offer = await this.prisma.offers.findUniqueOrThrow({ where: { id: parent.offer_id } });
    return { parent, children, declined: new Set(declined.map(e => e.event.split('.')[1].replace('_declined', '') as Step)), offer };
  }

  /** Qual passo do funil mostrar agora (ou nenhum). Pedido de cartão recusado conta como recusa e segue para o downsell. */
  private currentStep(s: Awaited<ReturnType<FunnelService['load']>>): Step | null {
    const { parent, children, declined, offer } = s;
    if (parent.parent_order_id || parent.idempotency_key.startsWith('renew:') || parent.status !== 'paid' || !parent.paid_at) return null; // renovação de assinatura não abre funil
    if (Date.now() - parent.paid_at.getTime() > FUNNEL_WINDOW_MS) return null;
    const up = children.find(c => c.funnel_step === 'upsell');
    if (!offer.upsell_offer_id) return null;
    if (!up && !declined.has('upsell')) return 'upsell';
    const upRefused = declined.has('upsell') || up?.status === 'failed';
    if (upRefused && offer.downsell_offer_id && !children.some(c => c.funnel_step === 'downsell') && !declined.has('downsell')) return 'downsell';
    return null;
  }

  /** Formas de pagar com 1 clique nesta oferta, dada a compra original. */
  private methodsFor(parent: { method: string; payments: { card_token_ref: string | null; card_brand: string | null; card_last4: string | null }[] }, offer: { methods: string[] }) {
    const p = parent.payments[0];
    const card = parent.method === 'card' && p?.card_token_ref && offer.methods.includes('card') ? { brand: p.card_brand ?? 'card', last4: p.card_last4 ?? '' } : null;
    const methods = [...(card ? ['card'] : []), ...(offer.methods.includes('pix') ? ['pix'] : [])] as ('card' | 'pix')[];
    return { card, methods };
  }

  private async sellable(offerId: string, workspaceId: string) {
    try {
      const o = await this.checkout.loadSellableOffer({ id: offerId });
      return o.workspace_id === workspaceId && o.billing_type === 'one_time' ? o : null;
    } catch { return null; }
  }

  /** GET /v1/orders/:id/upsell — o que mostrar na página de obrigado. */
  async state(parentId: string) {
    const s = await this.load(parentId);
    const accepted = s.children.map(c => ({
      step: c.funnel_step, order_id: c.id, code: c.code, status: c.status, method: c.method, total_cents: c.total_cents,
      next: c.status === 'pending' || c.status === 'paid' ? this.checkout.responseFor(c, c.payments[0]).next : null,
    }));
    let step = this.currentStep(s);
    let offer = step ? await this.sellable(step === 'upsell' ? s.offer.upsell_offer_id! : s.offer.downsell_offer_id!, s.parent.workspace_id) : null;
    // upsell fora do ar (pausado, esgotado): pula direto para o downsell, se houver
    if (step === 'upsell' && !offer && s.offer.downsell_offer_id && !s.children.some(c => c.funnel_step === 'downsell')) {
      step = 'downsell'; offer = await this.sellable(s.offer.downsell_offer_id, s.parent.workspace_id);
    }
    const pay = offer ? this.methodsFor(s.parent, offer) : null;
    if (!offer || !pay?.methods.length) return { step: null, offer: null, accepted };
    const product = offer.product;
    const options = pay.card ? installmentOptions(offer.price_cents, offer.max_installments, offer.installment_interest) : [];
    return {
      step, accepted,
      expires_at: new Date(s.parent.paid_at!.getTime() + FUNNEL_WINDOW_MS),
      offer: {
        offer_id: offer.id, price_cents: offer.price_cents, guarantee_days: offer.guarantee_days,
        headline: (step === 'upsell' ? s.offer.upsell_headline : s.offer.downsell_headline) || `Leve também ${product.name}`,
        text: step === 'upsell' ? s.offer.upsell_text : s.offer.downsell_text,
        product: { name: product.name, type: product.type, cover_url: product.cover_url, description: product.description },
        methods: pay.methods, card: pay.card,
        installment_options: options.map(o => ({ n: o.installments, installment_cents: o.installmentCents, total_cents: o.totalCents, interest_free: o.interestFree })),
      },
    };
  }

  /** POST /v1/orders/:id/upsell — aceitar (cobra com 1 clique) ou recusar o passo atual. */
  async decide(parentId: string, d: { step: Step; accept: boolean; method?: 'card' | 'pix'; installments?: number }, meta: { ip: string; ua: string }) {
    const s = await this.load(parentId);
    const current = (await this.state(parentId)).step;
    if (current !== d.step) {
      // clique repetido no mesmo botão: devolve o que já aconteceu, sem cobrar de novo
      if (s.children.some(c => c.funnel_step === d.step) || s.declined.has(d.step)) return this.state(parentId);
      throw new AppError('OFFER_UNAVAILABLE', { title: 'Esta oferta não está mais disponível.' });
    }
    if (!d.accept) {
      await this.prisma.order_events.create({ data: { order_id: parentId, from_status: 'paid', to_status: 'paid', event: `funnel.${d.step}_declined` } });
      return this.state(parentId);
    }

    const offer = await this.sellable(d.step === 'upsell' ? s.offer.upsell_offer_id! : s.offer.downsell_offer_id!, s.parent.workspace_id);
    if (!offer) throw new AppError('OFFER_UNAVAILABLE', { title: 'Esta oferta não está mais disponível.' });
    const pay = this.methodsFor(s.parent, offer);
    const method = d.method ?? pay.methods[0];
    if (!method || !pay.methods.includes(method)) throw new AppError('VALIDATION_ERROR', { fields: { method: 'Forma de pagamento indisponível.' } });

    const ws = offer.product.workspace;
    if (this.gateway.requiresSubaccountToSell && !ws.gateway_subaccount_id) throw new AppError('OFFER_UNAVAILABLE');
    if (ws.kyc_status !== 'approved') { // RN-66, como no checkout
      const [{ t }] = await this.prisma.$queryRaw<{ t: bigint | null }[]>`SELECT SUM(total_cents)::bigint t FROM orders WHERE workspace_id=${ws.id}::uuid AND status IN ('paid','refund_requested','chargeback')`;
      if ((t ?? 0n) >= 500_000n) throw new AppError('OFFER_UNAVAILABLE', { title: 'Esta oferta não está mais disponível.' });
    }
    const customer = await this.prisma.customers.findUniqueOrThrow({ where: { id: s.parent.customer_id } });

    let n = method === 'card' ? Math.max(1, Math.min(12, Math.floor(d.installments ?? 1))) : 1;
    const allowed = installmentOptions(offer.price_cents, offer.max_installments, offer.installment_interest).length;
    if (n > allowed) n = allowed;
    const plan = installmentPlan(offer.price_cents, n, offer.installment_interest);

    // afiliado da compra original, só se também for afiliado ativo do produto do upsell
    const affiliation = s.parent.affiliate_workspace_id && offer.product.affiliation_enabled
      ? await this.prisma.affiliations.findFirst({ where: { affiliate_workspace_id: s.parent.affiliate_workspace_id, product_id: offer.product_id, status: 'active' } })
      : null;
    const tier = ws.custom_fee_bps ?? (await this.prisma.fee_tiers_cache.findUnique({ where: { workspace_id: ws.id } }))?.fee_bps ?? null;
    const fee = computeFee({ baseCents: offer.price_cents, method, viaAffiliate: !!affiliation, tierBps: tier });
    const coproducers = (await this.prisma.coproductions.findMany({ where: { product_id: offer.product_id, status: 'active', OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] } })).map(cp => ({ id: cp.workspace_id, bps: cp.share_bps }));
    const split = computeSplit({
      baseCents: offer.price_cents, interestCents: plan.interestCents, absorbedCostCents: plan.absorbedCostCents, feeCents: fee.feeCents,
      producerId: ws.id, affiliate: affiliation ? { id: affiliation.affiliate_workspace_id, bps: offer.affiliate_commission_bps ?? offer.product.affiliate_commission_bps } : null, coproducers,
    });

    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const o = await tx.orders.create({
          data: {
            code: orderCode(), workspace_id: ws.id, customer_id: customer.id, offer_id: offer.id, status: 'created', method,
            installments: n, subtotal_cents: offer.price_cents, interest_cents: plan.interestCents, total_cents: plan.totalCents,
            affiliate_workspace_id: affiliation?.affiliate_workspace_id, tracking: s.parent.tracking ?? undefined,
            parent_order_id: parentId, funnel_step: d.step,
            ip_hash: s.parent.ip_hash, user_agent: meta.ua.slice(0, 400), device_fingerprint: s.parent.device_fingerprint, idempotency_key: `funnel:${parentId}:${d.step}`,
            items: { create: [{ product_id: offer.product_id, offer_id: offer.id, kind: 'main', price_cents: offer.price_cents }] },
            splits: { create: split.map(x => ({ beneficiary_type: x.beneficiary_type, beneficiary_id: x.beneficiary_id, amount_cents: x.amount_cents, rule: { ...x.rule, fee: fee.rule } as any })) },
          },
        });
        await tx.order_events.create({ data: { order_id: o.id, to_status: 'created', event: 'order.created', data: { method, funnel_step: d.step, parent_order_id: parentId } } });
        return o;
      });
    } catch (e) {
      // dois cliques ao mesmo tempo: o segundo encontra o pedido já criado e não cobra de novo
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return this.state(parentId);
      throw e;
    }

    const doc = decrypt(customer.document_enc), phone = decrypt(customer.phone_enc);
    const pixExpiresAt = new Date(Date.now() + offer.pix_expiration_min * 60_000);
    const subaccounts = await this.prisma.workspaces.findMany({ where: { id: { in: split.map(x => x.beneficiary_id).filter(Boolean) as string[] } }, select: { id: true, gateway_subaccount_id: true } });
    let charge;
    try {
      charge = await this.gateway.createCharge({
        idempotencyKey: `charge:${order.id}`, orderId: order.id, method, amountCents: plan.totalCents, installments: n,
        description: offer.product.name, customer: { name: customer.name, email: customer.email, document: doc, phone },
        savedCardRef: method === 'card' ? s.parent.payments[0].card_token_ref! : undefined, cardOnFile: method === 'card' ? 'one_click' : undefined,
        pixExpiresAt, boletoDueAt: new Date(Date.now() + 3 * 86400000),
        split: split.map(x => ({ kind: x.beneficiary_type, amountCents: x.amount_cents, subaccountId: subaccounts.find(w => w.id === x.beneficiary_id)?.gateway_subaccount_id ?? null })),
      });
    } catch (e) {
      this.log.error(`gateway falhou no ${d.step}: ${(e as Error).message}`);
      await this.prisma.orders.update({ where: { id: order.id }, data: { status: 'failed' } });
      throw new AppError('INTERNAL_ERROR', { title: 'Não conseguimos concluir agora. Tente de novo em instantes.' });
    }

    await this.prisma.payments.create({
      data: {
        order_id: order.id, provider: this.gateway.name, provider_charge_id: charge.chargeId, method, status: charge.status, raw_status: charge.rawStatus,
        decline_code: charge.declineCode, card_brand: charge.card?.brand, card_last4: charge.card?.last4, card_token_ref: charge.card?.tokenRef,
        pix_qr: charge.pix?.qrDataUrl, pix_copy_paste: charge.pix?.copyPaste, pix_expires_at: charge.pix?.expiresAt, risk_score: charge.riskScore,
      },
    });
    const declined = charge.status === 'declined';
    const nextStatus = declined ? 'failed' : 'pending';
    await this.prisma.$transaction(async (tx) => {
      await tx.orders.update({ where: { id: order.id }, data: { status: nextStatus } });
      await tx.order_events.create({ data: { order_id: order.id, from_status: 'created', to_status: nextStatus, event: declined ? 'payment.declined' : 'payment.created', data: { decline_code: charge.declineCode } } });
    });
    if (method === 'pix' && !declined) {
      await this.queue.addDelayed('pix.expire', { orderId: order.id }, pixExpiresAt.getTime() - Date.now() + 2000, `pixexp:${order.id}:${pixExpiresAt.getTime()}`);
      void this.notify.send({ channel: 'email', to: customer.email, template: 'pix_generated', workspaceId: ws.id, refType: 'order', refId: order.id, vars: { produtor: ws.name, valor: formatBRL(plan.totalCents), produto: offer.product.name, hora: pixExpiresAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }), link_pix: urls.pix(order.id, pixExpiresAt) } });
    }
    const st = await this.state(parentId);
    return declined ? { ...st, declined: { title: 'O cartão não passou nesta compra. Sua primeira compra continua confirmada.' } } : st;
  }
}
