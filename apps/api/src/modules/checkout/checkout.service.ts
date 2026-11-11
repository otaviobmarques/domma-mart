import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { AppError, ErrorCode } from '../../common/errors';
import { computeFee, computeSplit, installmentPlan, installmentOptions, applyCoupon, FEES, Method } from '../../domain/money';
import { isValidDocument, isValidName, isValidEmailFormat, isDisposableEmail, normalizeBRMobile, onlyDigits } from '../../domain/validators';
import { encrypt, blindIndex, orderCode, hashIp, decrypt } from '../../common/crypto';
import * as rl from '../../infra/rate-limit';
import { QueueService } from '../../infra/queue.service';
import { NotifyService } from '../../infra/notify.service';
import { urls } from '../../common/urls';
import { formatBRL } from '../../domain/money';

export interface CreateOrderBody {
  customer: { name: string; email: string; phone: string; document: string };
  method: Method;
  installments?: number;
  card_token?: string;
  bump_offer_ids?: string[];
  coupon_code?: string;
  tracking?: Record<string, string>;
  affiliate_code?: string;
  device_fingerprint?: string;
}

@Injectable()
export class CheckoutService {
  private log = new Logger('Checkout');
  constructor(
    private prisma: PrismaService,
    @Inject(GATEWAY) private gateway: GatewayAdapter,
    private queue: QueueService,
    private notify: NotifyService,
  ) {}

  /** Oferta disponível para venda? (estados da tela 19.1) */
  async loadSellableOffer(where: { slug?: string; id?: string }) {
    const offer = await this.prisma.offers.findFirst({ where, include: { product: { include: { workspace: true } }, bumps: { orderBy: { position: 'asc' } } } });
    if (!offer || offer.product.deleted_at) throw new AppError('OFFER_UNAVAILABLE');
    const p = offer.product;
    if (offer.status === 'draft' || offer.status === 'paused' || p.moderation_status !== 'approved' || p.workspace.blocked_at) throw new AppError('OFFER_UNAVAILABLE', { seller_whatsapp: p.workspace.support_whatsapp });
    if (offer.status === 'ended' || (offer.ends_at && offer.ends_at < new Date())) throw new AppError('OFFER_UNAVAILABLE', { title: `Esta oferta terminou em ${(offer.ends_at ?? new Date()).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, ended: true });
    if (offer.sales_limit != null) {
      const sold = await this.prisma.orders.count({ where: { offer_id: offer.id, status: { in: ['paid', 'refund_requested', 'chargeback'] } } });
      if (sold >= offer.sales_limit) throw new AppError('OFFER_SOLD_OUT');
    }
    return offer;
  }

  /** Num domínio próprio ativo, só as ofertas do dono do domínio podem ser vendidas. */
  async assertHost(workspaceId: string, host?: string) {
    if (!host) return;
    const d = await this.prisma.custom_domains.findUnique({ where: { hostname: host.toLowerCase().split(':')[0] } });
    if (d && d.status === 'active' && d.workspace_id !== workspaceId) throw new AppError('OFFER_UNAVAILABLE');
  }

  async publicOffer(slug: string, tracking: Record<string, string>, host?: string) {
    const offer = await this.loadSellableOffer({ slug });
    await this.assertHost(offer.workspace_id, host);
    const p = offer.product;
    const bumps = await this.prisma.offers.findMany({ where: { id: { in: offer.bumps.map(b => b.bump_offer_id) }, status: 'active' }, include: { product: true } });
    await this.prisma.checkout_views.create({ data: { workspace_id: offer.workspace_id, offer_id: offer.id, tracking } });
    const owner = await this.prisma.users.findUnique({ where: { id: p.workspace.owner_id } });
    const options = installmentOptions(offer.price_cents, offer.max_installments, offer.installment_interest);
    return {
      offer_id: offer.id, slug: offer.slug, price_cents: offer.price_cents, methods: offer.methods,
      billing_type: offer.billing_type, interval: offer.interval, guarantee_days: offer.guarantee_days,
      max_installments: options.length, installment_interest: offer.installment_interest,
      installment_options: options.map(o => ({ n: o.installments, installment_cents: o.installmentCents, total_cents: o.totalCents, interest_free: o.interestFree })),
      product: { id: p.id, name: p.name, type: p.type, cover_url: p.cover_url, description: p.description },
      seller: { name: p.workspace.name || owner?.name, whatsapp: p.workspace.support_whatsapp },
      theme: offer.theme ?? {},
      bumps: offer.bumps.map(b => { const o = bumps.find(x => x.id === b.bump_offer_id); return o && { offer_id: o.id, name: o.product.name, headline: b.headline, price_cents: o.price_cents, cover_url: o.product.cover_url }; }).filter(Boolean),
      gateway: this.gateway.name,
      turnstile_site_key: process.env.TURNSTILE_SITE_KEY || null,
    };
  }

  async findCoupon(workspaceId: string, offerId: string, code: string, documentHash?: string) {
    const c = await this.prisma.coupons.findUnique({ where: { workspace_id_code: { workspace_id: workspaceId, code: code.toUpperCase() } } });
    const now = new Date();
    if (!c || !c.active || (c.starts_at && c.starts_at > now) || (c.ends_at && c.ends_at < now)) return null;
    if (c.offer_ids.length && !c.offer_ids.includes(offerId)) return null;
    if (c.max_uses != null && c.uses >= c.max_uses) return null;
    if (documentHash && c.max_uses_per_cpf != null) {
      // contagem por CPF via customers.document_hash
      const byCpf = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint n FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.coupon_id=${c.id}::uuid AND c.document_hash=${documentHash} AND o.status IN ('paid','pending')`;
      if (Number(byCpf[0].n) >= c.max_uses_per_cpf) return null;
    }
    return c;
  }

  async validateCoupon(offerId: string, code: string) {
    const offer = await this.loadSellableOffer({ id: offerId });
    const c = await this.findCoupon(offer.workspace_id, offer.id, code);
    if (!c) throw new AppError('COUPON_INVALID');
    return { code: c.code, kind: c.kind, value: c.value, discount_cents: applyCoupon(offer.price_cents, c) };
  }

  async saveLead(offerId: string, email: string, name?: string, phone?: string) {
    if (!isValidEmailFormat(email) || isDisposableEmail(email)) return { ok: true };
    const offer = await this.loadSellableOffer({ id: offerId });
    const lead = await this.prisma.checkout_leads.upsert({
      where: { offer_id_email: { offer_id: offer.id, email } },
      create: { workspace_id: offer.workspace_id, offer_id: offer.id, email, name, phone_enc: phone ? encrypt(phone) : undefined },
      update: { name, phone_enc: phone ? encrypt(phone) : undefined },
    });
    if (!lead.converted_at) await this.queue.addDelayed('abandoned.check', { leadId: lead.id }, 30 * 60_000, `abandon:${lead.id}:${Math.floor(Date.now() / 600_000)}`); // RN-41
    return { ok: true };
  }

  /** POST /v1/checkout/{offerId}/orders — seção 8.2/8.3 e contrato 22.1. */
  async createOrder(offerId: string, body: CreateOrderBody, meta: { ip: string; ua: string; idempotencyKey: string; affiliateCookie?: string; host?: string }) {
    // RN-30: mesma chave devolve o mesmo resultado sem nova cobrança
    const prior = await this.prisma.orders.findUnique({ where: { idempotency_key: meta.idempotencyKey }, include: { payments: { orderBy: { created_at: 'desc' }, take: 1 } } });
    if (prior) return this.responseFor(prior, prior.payments[0]);

    const ipHash = hashIp(meta.ip);
    await rl.limit(`order:ip:${ipHash}`, 30, 600);
    const offer = await this.loadSellableOffer({ id: offerId });
    await this.assertHost(offer.workspace_id, meta.host);
    if (!offer.methods.includes(body.method)) throw new AppError('VALIDATION_ERROR', { fields: { method: 'Forma de pagamento indisponível.' } });
    if (offer.billing_type === 'subscription' && body.method !== 'card') throw new AppError('VALIDATION_ERROR', { fields: { method: 'Assinaturas são cobradas no cartão.' } });

    // Validações do comprador (19.1)
    const c = body.customer ?? ({} as any);
    const fields: Record<string, string> = {};
    if (!isValidName(c.name)) fields['customer.name'] = 'Digite seu nome completo.';
    if (!isValidEmailFormat(c.email)) fields['customer.email'] = 'Confira seu e-mail. Ele parece estar incompleto.';
    const phone = normalizeBRMobile(c.phone);
    if (!phone) fields['customer.phone'] = 'Confira o número com DDD.';
    if (!isValidDocument(c.document)) fields['customer.document'] = 'CPF inválido. Confira os números.';
    if (Object.keys(fields).length) throw new AppError(fields['customer.document'] && Object.keys(fields).length === 1 ? 'CPF_INVALID' : 'VALIDATION_ERROR', { fields });
    if (isDisposableEmail(c.email)) throw new AppError('EMAIL_DISPOSABLE', { fields: { 'customer.email': 'Use um e-mail que você acessa sempre. É para ele que enviamos seu acesso.' } });
    const doc = onlyDigits(c.document);
    const docHash = blindIndex(doc);
    const email = c.email.trim().toLowerCase();

    // Listas de bloqueio (RN-62) e velocidade (RN-16)
    const blocked = await this.prisma.blocklist.findFirst({ where: { OR: [{ kind: 'cpf', value_hash: docHash }, { kind: 'email', value_hash: blindIndex(email) }, { kind: 'email_domain', value_hash: blindIndex(email.split('@')[1]) }, { kind: 'ip', value_hash: ipHash }], AND: [{ OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] }] } });
    if (blocked) throw new AppError('CARD_RISK_BLOCKED');
    if (body.method === 'card') {
      for (const k of [`cpf:${docHash}`, `ip:${ipHash}`]) if (await rl.isBlocked(`card:${k}`)) throw new AppError('RATE_LIMITED');
      if (await rl.isBlocked(`card:offer:${offer.id}`)) throw new AppError('CARD_RISK_BLOCKED', { title: 'Pagamento com cartão indisponível no momento. Pague com Pix.' });
    }

    // RN-66: sem identidade aprovada, vende até R$ 5.000
    const ws = offer.product.workspace;
    if (ws.kyc_status !== 'approved') {
      const [{ s }] = await this.prisma.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(total_cents)::bigint s FROM orders WHERE workspace_id=${ws.id}::uuid AND status IN ('paid','refund_requested','chargeback')`;
      if ((s ?? 0n) >= 500_000n) throw new AppError('OFFER_UNAVAILABLE', { title: 'Esta oferta está temporariamente indisponível.' });
    }

    // Itens: oferta principal + até 3 ofertas especiais do mesmo produtor (RN-23)
    const bumpIds = [...new Set(body.bump_offer_ids ?? [])].filter(id => offer.bumps.some(b => b.bump_offer_id === id)).slice(0, 3);
    const bumpOffers = bumpIds.length ? await this.prisma.offers.findMany({ where: { id: { in: bumpIds }, workspace_id: offer.workspace_id, status: 'active' } }) : [];

    // Cupom (RN-20..22): só na principal
    let coupon = null as Awaited<ReturnType<CheckoutService['findCoupon']>>;
    if (body.coupon_code) {
      coupon = await this.findCoupon(offer.workspace_id, offer.id, body.coupon_code, docHash);
      if (!coupon) throw new AppError('COUPON_INVALID', { fields: { coupon_code: 'Cupom inválido ou expirado.' } });
    }
    const discount = applyCoupon(offer.price_cents, coupon);
    const subtotal = offer.price_cents + bumpOffers.reduce((s, b) => s + b.price_cents, 0n);
    const base = subtotal - discount; // RN-01: preço sempre do servidor
    if (base < FEES.minOrderCents) throw new AppError('VALIDATION_ERROR');
    if (base > FEES.maxOrderCents) throw new AppError('VALIDATION_ERROR', { title: 'Valor acima do limite. Fale com o vendedor.' });

    // Parcelas (RN-07/08)
    let n = body.method === 'card' ? Math.max(1, Math.min(12, Math.floor(body.installments ?? 1))) : 1;
    const allowed = installmentOptions(base, offer.max_installments, offer.installment_interest).length;
    if (n > allowed) n = allowed;
    const plan = installmentPlan(base, n, offer.installment_interest);

    // Afiliado (RN-70/71)
    const affiliation = await this.resolveAffiliate(offer.product_id, body.affiliate_code || meta.affiliateCookie, { docHash, email, ipHash, fingerprint: body.device_fingerprint });

    // Taxa (RN-02..05) e divisão (RN-09/10), congeladas no pedido (RN-06)
    const tier = ws.custom_fee_bps ?? (await this.prisma.fee_tiers_cache.findUnique({ where: { workspace_id: ws.id } }))?.fee_bps ?? null;
    const fee = computeFee({ baseCents: base, method: body.method, viaAffiliate: !!affiliation, tierBps: tier });
    const coproducers = (await this.prisma.coproductions.findMany({ where: { product_id: offer.product_id, status: 'active', OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] } })).map(cp => ({ id: cp.workspace_id, bps: cp.share_bps }));
    const split = computeSplit({
      baseCents: base, interestCents: plan.interestCents, absorbedCostCents: plan.absorbedCostCents, feeCents: fee.feeCents,
      producerId: ws.id, affiliate: affiliation ? { id: affiliation.affiliate_workspace_id, bps: offer.product.affiliate_commission_bps } : null, coproducers,
    });

    // Comprador (único por plataforma — 21.8)
    const customer = await this.prisma.customers.upsert({
      where: { email },
      create: { email, name: c.name.trim(), document_enc: encrypt(doc), document_hash: docHash, phone_enc: encrypt(phone!), phone_hash: blindIndex(phone!) },
      update: { name: c.name.trim(), document_enc: encrypt(doc), document_hash: docHash, phone_enc: encrypt(phone!), phone_hash: blindIndex(phone!) },
    });

    const now = Date.now();
    const pixExpiresAt = new Date(now + offer.pix_expiration_min * 60_000);
    const boletoDueAt = new Date(now + offer.boleto_due_days * 86400000);

    const order = await this.prisma.$transaction(async (tx) => {
      const o = await tx.orders.create({
        data: {
          code: orderCode(), workspace_id: ws.id, customer_id: customer.id, offer_id: offer.id, status: 'created', method: body.method,
          installments: n, subtotal_cents: subtotal, discount_cents: discount, interest_cents: plan.interestCents, total_cents: plan.totalCents,
          coupon_id: coupon?.id, affiliate_workspace_id: affiliation?.affiliate_workspace_id, tracking: sanitizeTracking(body.tracking),
          ip_hash: ipHash, user_agent: meta.ua.slice(0, 400), device_fingerprint: body.device_fingerprint?.slice(0, 100), idempotency_key: meta.idempotencyKey,
          items: { create: [{ product_id: offer.product_id, offer_id: offer.id, kind: 'main', price_cents: offer.price_cents - discount }, ...bumpOffers.map(b => ({ product_id: b.product_id, offer_id: b.id, kind: 'bump', price_cents: b.price_cents }))] },
          splits: { create: split.map(s => ({ beneficiary_type: s.beneficiary_type, beneficiary_id: s.beneficiary_id, amount_cents: s.amount_cents, rule: { ...s.rule, fee: fee.rule } as any })) },
        },
      });
      await tx.order_events.create({ data: { order_id: o.id, to_status: 'created', event: 'order.created', data: { method: body.method } } });
      if (coupon) await tx.coupons.update({ where: { id: coupon.id }, data: { uses: { increment: 1 } } });
      if (affiliation) await this.bindAffiliate(tx, offer.product_id, affiliation.id, docHash, email, offer.product.affiliate_cookie_days);
      return o;
    });

    // Cobrança no gateway com split (subcontas)
    const subaccounts = await this.prisma.workspaces.findMany({ where: { id: { in: split.map(s => s.beneficiary_id).filter(Boolean) as string[] } }, select: { id: true, gateway_subaccount_id: true } });
    let charge;
    try {
      charge = await this.gateway.createCharge({
        idempotencyKey: `charge:${order.id}`, orderId: order.id, method: body.method, amountCents: plan.totalCents, installments: n,
        description: offer.product.name, customer: { name: c.name, email, document: doc, phone: phone! }, cardToken: body.card_token,
        pixExpiresAt, boletoDueAt,
        split: split.map(s => ({ kind: s.beneficiary_type, amountCents: s.amount_cents, subaccountId: subaccounts.find(w => w.id === s.beneficiary_id)?.gateway_subaccount_id ?? null })),
      });
    } catch (e) {
      this.log.error(`gateway falhou: ${(e as Error).message}`);
      await this.prisma.$transaction(tx => tx.orders.update({ where: { id: order.id }, data: { status: 'failed' } }));
      throw new AppError('INTERNAL_ERROR');
    }

    const payment = await this.prisma.payments.create({
      data: {
        order_id: order.id, provider: this.gateway.name, provider_charge_id: charge.chargeId, method: body.method, status: charge.status, raw_status: charge.rawStatus,
        decline_code: charge.declineCode, card_brand: charge.card?.brand, card_last4: charge.card?.last4, card_token_ref: charge.card?.tokenRef,
        pix_qr: charge.pix?.qrDataUrl, pix_copy_paste: charge.pix?.copyPaste, pix_expires_at: charge.pix?.expiresAt,
        boleto_url: charge.boleto?.url, boleto_line: charge.boleto?.line, boleto_due_at: charge.boleto?.dueAt, risk_score: charge.riskScore,
      },
    });

    const nextStatus = charge.status === 'declined' ? 'failed' : 'pending';
    await this.prisma.$transaction(async (tx) => {
      await tx.orders.update({ where: { id: order.id }, data: { status: nextStatus } });
      await tx.order_events.create({ data: { order_id: order.id, from_status: 'created', to_status: nextStatus, event: charge.status === 'declined' ? 'payment.declined' : 'payment.created', data: { decline_code: charge.declineCode } } });
    });

    if (charge.status === 'declined') {
      await this.onCardDeclined(offer.id, docHash, ipHash);
      await this.queue.add('recovery.start', { orderId: order.id, kind: 'card_declined' });
      const code = (charge.declineCode as ErrorCode) || 'CARD_DECLINED';
      throw new AppError(code, { order_id: order.id });
    }
    if (body.method === 'pix') {
      await this.queue.addDelayed('pix.expire', { orderId: order.id }, pixExpiresAt.getTime() - Date.now() + 2000, `pixexp:${order.id}:${pixExpiresAt.getTime()}`);
      await this.queue.add('recovery.start', { orderId: order.id, kind: 'pix_unpaid' });
      void this.notify.send({ channel: 'email', to: email, template: 'pix_generated', workspaceId: ws.id, refType: 'order', refId: order.id, vars: { produtor: ws.name, valor: formatBRL(plan.totalCents), produto: offer.product.name, hora: pixExpiresAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }), link_pix: urls.pix(order.id, pixExpiresAt) } });
    }
    if (body.method === 'boleto') {
      await this.queue.add('recovery.start', { orderId: order.id, kind: 'boleto_unpaid' });
      void this.notify.send({ channel: 'email', to: email, template: 'boleto_generated', workspaceId: ws.id, refType: 'order', refId: order.id, vars: { produtor: ws.name, valor: formatBRL(plan.totalCents), data: boletoDueAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), linha_digitavel: charge.boleto!.line, link: urls.boleto(order.id) } });
    }
    return this.responseFor({ ...order, status: nextStatus }, payment);
  }

  responseFor(order: { id: string; code: string; status: string; total_cents: bigint; method: string; installments: number }, payment?: { pix_expires_at: Date | null } | null) {
    let next: any;
    if (order.method === 'pix') {
      const exp = payment?.pix_expires_at ?? new Date();
      next = { type: 'pix', url: `/pix/${order.id}?t=${urls.pix(order.id, exp).split('?t=')[1]}`, expires_at: exp };
    } else if (order.method === 'boleto') next = { type: 'boleto', url: `/boleto/${order.id}?t=${urls.boleto(order.id).split('?t=')[1]}` };
    else next = { type: 'redirect', url: `/obrigado/${order.id}?t=${urls.thanks(order.id).split('?t=')[1]}` };
    return { order_id: order.id, code: order.code, status: order.status, total_cents: order.total_cents, method: order.method, installments: order.installments, next };
  }

  /** RN-61: mais de 20 recusas em 10 min numa oferta pausa o cartão por 30 min. RN-16: 5 recusas/h por CPF/IP. */
  private async onCardDeclined(offerId: string, docHash: string, ipHash: string) {
    if ((await rl.hit(`decl:offer:${offerId}`, 600)) > 20) { await rl.block(`card:offer:${offerId}`, 1800); this.log.warn(`teste de cartão na oferta ${offerId} — cartão pausado por 30 min`); }
    for (const k of [`cpf:${docHash}`, `ip:${ipHash}`]) if ((await rl.hit(`decl:${k}`, 3600)) >= 5) await rl.block(`card:${k}`, 3600);
  }

  private async resolveAffiliate(productId: string, code: string | undefined, buyer: { docHash: string; email: string; ipHash: string; fingerprint?: string }) {
    const product = await this.prisma.products.findUniqueOrThrow({ where: { id: productId } });
    if (!product.affiliation_enabled) return null;
    const keys = [`doc:${buyer.docHash}`, `email:${blindIndex(buyer.email)}`];
    const binding = await this.prisma.affiliate_bindings.findFirst({ where: { product_id: productId, customer_key: { in: keys }, expires_at: { gt: new Date() } }, orderBy: { updated_at: 'desc' } });
    let affiliation = null;
    const fromCode = code ? await this.prisma.affiliations.findFirst({ where: { code, product_id: productId, status: 'active' } }) : null;
    if (product.affiliate_attribution === 'first_click' && binding) affiliation = await this.prisma.affiliations.findFirst({ where: { id: binding.affiliation_id, status: 'active' } });
    affiliation = affiliation ?? fromCode ?? (binding ? await this.prisma.affiliations.findFirst({ where: { id: binding.affiliation_id, status: 'active' } }) : null);
    if (!affiliation) return null;
    // RN-71: sem comissão em autocompra
    const aff = await this.prisma.users.findUnique({ where: { id: affiliation.affiliate_user_id } });
    const affWs = await this.prisma.workspaces.findUnique({ where: { id: affiliation.affiliate_workspace_id } });
    if (aff?.email.toLowerCase() === buyer.email || affWs?.document_hash === buyer.docHash) return null;
    const affClickSameIp = await this.prisma.sessions.findFirst({ where: { user_id: affiliation.affiliate_user_id, ip_hash: buyer.ipHash, created_at: { gt: new Date(Date.now() - 30 * 86400000) } } });
    if (affClickSameIp) return null;
    return affiliation;
  }

  private async bindAffiliate(tx: any, productId: string, affiliationId: string, docHash: string, email: string, days: number) {
    const expires_at = new Date(Date.now() + days * 86400000);
    for (const key of [`doc:${docHash}`, `email:${blindIndex(email)}`]) {
      await tx.affiliate_bindings.upsert({ where: { product_id_customer_key: { product_id: productId, customer_key: key } }, create: { product_id: productId, customer_key: key, affiliation_id: affiliationId, expires_at }, update: { affiliation_id: affiliationId, expires_at } });
    }
  }

  /** Gera novo Pix no mesmo pedido (RN-13, tela 19.2). */
  async renewPix(orderId: string) {
    const order = await this.prisma.orders.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.method !== 'pix' || !['expired', 'pending'].includes(order.status)) throw new AppError('NOT_FOUND');
    const offer = await this.prisma.offers.findUniqueOrThrow({ where: { id: order.offer_id }, include: { product: true } });
    const customer = await this.prisma.customers.findUniqueOrThrow({ where: { id: order.customer_id } });
    const latest = await this.prisma.payments.findFirst({ where: { order_id: orderId }, orderBy: { created_at: 'desc' } });
    if (order.status === 'pending' && latest?.pix_expires_at && latest.pix_expires_at > new Date()) return this.responseFor(order, latest);
    const pixExpiresAt = new Date(Date.now() + offer.pix_expiration_min * 60_000);
    const splits = await this.prisma.splits.findMany({ where: { order_id: orderId } });
    const charge = await this.gateway.createCharge({
      idempotencyKey: `charge:${orderId}:${Date.now()}`, orderId, method: 'pix', amountCents: order.total_cents, installments: 1, description: offer.product.name,
      customer: { name: customer.name, email: customer.email, document: decrypt(customer.document_enc), phone: decrypt(customer.phone_enc) }, pixExpiresAt,
      split: splits.map(s => ({ kind: s.beneficiary_type, amountCents: s.amount_cents, subaccountId: null })),
    });
    const payment = await this.prisma.payments.create({ data: { order_id: orderId, provider: this.gateway.name, provider_charge_id: charge.chargeId, method: 'pix', status: 'pending', raw_status: charge.rawStatus, pix_qr: charge.pix!.qrDataUrl, pix_copy_paste: charge.pix!.copyPaste, pix_expires_at: pixExpiresAt } });
    await this.prisma.$transaction(async (tx) => {
      if (order.status === 'expired') {
        await tx.orders.update({ where: { id: orderId }, data: { status: 'pending' } });
        await tx.order_events.create({ data: { order_id: orderId, from_status: 'expired', to_status: 'pending', event: 'pix.renewed' } });
      }
    });
    await this.queue.addDelayed('pix.expire', { orderId }, pixExpiresAt.getTime() - Date.now() + 2000, `pixexp:${orderId}:${pixExpiresAt.getTime()}`);
    return this.responseFor({ ...order, status: 'pending' }, payment);
  }
}

function sanitizeTracking(t?: Record<string, string>) {
  if (!t) return undefined;
  const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'fbclid', 'gclid', 'referrer'];
  return Object.fromEntries(Object.entries(t).filter(([k, v]) => allowed.includes(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 300)]));
}
