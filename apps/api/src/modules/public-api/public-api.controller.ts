import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { ApiKey, Key, ApiKeyCtx, Public } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { decrypt, encrypt, randomToken } from '../../common/crypto';
import { maskEmail } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { statusLabel, OrderStatus } from '../../domain/order-state';
import { page, pageArgs } from '../../domain/api-keys';
import { WEBHOOK_EVENTS, sampleEvent } from '../../domain/webhook-events';
import { isPublicHttpUrl } from '../integrations/ssrf';
import { urls } from '../../common/urls';
import { buildPublicSpec } from './spec';

const STATUSES = ['created', 'pending', 'paid', 'failed', 'expired', 'refund_requested', 'refunded', 'chargeback', 'chargeback_won', 'chargeback_lost'] as const;
const date = (v?: string) => { if (!v) return undefined; const d = new Date(v); if (isNaN(d.getTime())) throw new AppError('VALIDATION_ERROR', { fields: { date: 'Use data ISO 8601, ex.: 2026-11-01T00:00:00-03:00' } }); return d; };
const uuidOr404 = (id: string) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND'); };

/**
 * API pública REST (Fase 2): /api/v1, autenticada por chave com permissões (Authorization: Bearer dm_live_...).
 * Valores em centavos; datas em ISO 8601 (UTC); listas paginadas por cursor (next_cursor).
 * Tudo é sempre da conta dona da chave.
 */
@Controller('api/v1')
export class PublicApiController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('openapi.json') @Public()
  spec() { return buildPublicSpec(); }

  @Get('me') @ApiKey()
  async me(@Key() k: ApiKeyCtx) {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: k.workspaceId } });
    const key = await this.prisma.api_keys.findUniqueOrThrow({ where: { id: k.keyId } });
    return { account: { id: ws.id, name: ws.name }, key: { id: key.id, name: key.name, scopes: key.scopes, created_at: key.created_at } };
  }

  // ───── Vendas ─────
  private async saleRows(k: ApiKeyCtx, orders: any[]) {
    const full = k.scopes.includes('customers:read');
    const [customers, products, affiliates] = await Promise.all([
      this.prisma.customers.findMany({ where: { id: { in: [...new Set(orders.map(o => o.customer_id))] } } }),
      this.prisma.products.findMany({ where: { id: { in: [...new Set(orders.flatMap(o => o.items.map((i: any) => i.product_id)))] } }, select: { id: true, name: true } }),
      this.prisma.workspaces.findMany({ where: { id: { in: orders.map(o => o.affiliate_workspace_id).filter(Boolean) } }, select: { id: true, name: true } }),
    ]);
    const coupons = await this.prisma.coupons.findMany({ where: { id: { in: orders.map(o => o.coupon_id).filter(Boolean) } }, select: { id: true, code: true } });
    return orders.map(o => {
      const cu = customers.find(c => c.id === o.customer_id)!;
      const mine = o.splits.filter((s: any) => s.beneficiary_id === k.workspaceId).reduce((a: bigint, s: any) => a + s.amount_cents, 0n);
      return {
        id: o.id, code: o.code, status: o.status, status_label: statusLabel(o.status as OrderStatus), method: o.method, installments: o.installments,
        subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, interest_cents: o.interest_cents, total_cents: o.total_cents, net_cents: mine,
        created_at: o.created_at, paid_at: o.paid_at, refunded_at: o.refunded_at, guarantee_ends_at: o.guarantee_ends_at,
        items: o.items.map((i: any) => ({ product_id: i.product_id, offer_id: i.offer_id, name: products.find(p => p.id === i.product_id)?.name, kind: i.kind, price_cents: i.price_cents, status: i.status })),
        customer: { id: cu.id, name: cu.name, email: cu.email, ...(full ? { phone: decrypt(cu.phone_enc), document: decrypt(cu.document_enc) } : {}) },
        affiliate: o.affiliate_workspace_id ? { id: o.affiliate_workspace_id, name: affiliates.find(a => a.id === o.affiliate_workspace_id)?.name } : null,
        coupon: coupons.find(c => c.id === o.coupon_id)?.code ?? null,
        subscription_id: o.subscription_id, funnel_step: o.funnel_step, parent_order_id: o.parent_order_id, tracking: o.tracking ?? {},
      };
    });
  }

  @Get('sales') @ApiKey('sales:read')
  async sales(@Key() k: ApiKeyCtx, @Query() q: Record<string, string>) {
    const { limit, cursor } = pageArgs(q);
    if (q.status && !STATUSES.includes(q.status as any)) throw new AppError('VALIDATION_ERROR', { fields: { status: `Use um destes: ${STATUSES.join(', ')}` } });
    if (q.product_id) uuidOr404(q.product_id);
    const where: Prisma.ordersWhereInput = {
      workspace_id: k.workspaceId, ...(q.status ? { status: q.status as OrderStatus } : {}),
      ...(q.product_id ? { items: { some: { product_id: q.product_id } } } : {}),
      ...(q.email ? { customer_id: (await this.prisma.customers.findUnique({ where: { email: q.email.trim().toLowerCase() } }))?.id ?? '00000000-0000-0000-0000-000000000000' } : {}),
      created_at: { gte: date(q.created_since), lte: date(q.created_until) },
      ...(q.paid_since ? { paid_at: { gte: date(q.paid_since) } } : {}),
      ...(cursor ? { id: { lt: cursor } } : {}),
    };
    const rows = await this.prisma.orders.findMany({ where, include: { items: true, splits: true }, orderBy: { id: 'desc' }, take: limit + 1 });
    const p = page(rows, limit);
    return toJSON({ ...p, data: await this.saleRows(k, p.data) });
  }

  @Get('sales/:id') @ApiKey('sales:read')
  async sale(@Key() k: ApiKeyCtx, @Param('id') id: string) {
    const o = await this.prisma.orders.findFirst({ where: { workspace_id: k.workspaceId, ...(/^DM-/i.test(id) ? { code: id.toUpperCase() } : (uuidOr404(id), { id })) }, include: { items: true, splits: true, events: { orderBy: { created_at: 'asc' } } } });
    if (!o) throw new AppError('NOT_FOUND');
    const [row] = await this.saleRows(k, [o]);
    return toJSON({ ...row, events: o.events.map(e => ({ at: e.created_at, event: e.event, status: e.to_status })) });
  }

  @Get('refunds') @ApiKey('sales:read')
  async refunds(@Key() k: ApiKeyCtx, @Query() q: Record<string, string>) {
    const { limit, cursor } = pageArgs(q);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT r.id, r.order_id, o.code order_code, r.requested_by, r.reason, r.amount_cents, r.status, r.created_at, r.updated_at
      FROM refunds r JOIN orders o ON o.id=r.order_id WHERE o.workspace_id=${k.workspaceId}::uuid ${cursor ? Prisma.sql`AND r.id < ${cursor}::uuid` : Prisma.empty}
      ORDER BY r.id DESC LIMIT ${limit + 1}`);
    return toJSON(page(rows, limit));
  }

  @Get('subscriptions') @ApiKey('sales:read')
  async subscriptions(@Key() k: ApiKeyCtx, @Query() q: Record<string, string>) {
    const { limit, cursor } = pageArgs(q);
    const rows = await this.prisma.subscriptions.findMany({ where: { workspace_id: k.workspaceId, ...(q.status ? { status: q.status } : {}), ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1 });
    const p = page(rows, limit);
    const customers = await this.prisma.customers.findMany({ where: { id: { in: p.data.map(s => s.customer_id) } } });
    return toJSON({ ...p, data: p.data.map(s => {
      const cu = customers.find(c => c.id === s.customer_id)!;
      return { id: s.id, status: s.status, offer_id: s.offer_id, price_cents: s.price_cents, current_period_end: s.current_period_end, next_charge_at: s.next_charge_at, cancel_at_period_end: s.cancel_at_period_end, card: s.card_last4 ? { brand: s.card_brand, last4: s.card_last4 } : null, created_at: s.created_at, customer: { id: cu.id, name: cu.name, email: cu.email } };
    }) });
  }

  // ───── Compradores (dados pessoais completos) ─────
  @Get('customers') @ApiKey('customers:read')
  async customers(@Key() k: ApiKeyCtx, @Query() q: Record<string, string>) {
    const { limit, cursor } = pageArgs(q);
    const rows = await this.prisma.$queryRaw<{ id: string; orders: number; paid_cents: bigint; first_at: Date; last_at: Date }[]>(Prisma.sql`
      SELECT c.id, COUNT(o.id)::int orders, COALESCE(SUM(o.total_cents) FILTER (WHERE o.paid_at IS NOT NULL AND o.status='paid'),0)::bigint paid_cents, MIN(o.created_at) first_at, MAX(o.created_at) last_at
      FROM customers c JOIN orders o ON o.customer_id=c.id AND o.workspace_id=${k.workspaceId}::uuid
      ${cursor ? Prisma.sql`WHERE c.id < ${cursor}::uuid` : Prisma.empty} GROUP BY c.id ORDER BY c.id DESC LIMIT ${limit + 1}`);
    const p = page(rows, limit);
    const cs = await this.prisma.customers.findMany({ where: { id: { in: p.data.map(r => r.id) } } });
    return toJSON({ ...p, data: p.data.map(r => { const c = cs.find(x => x.id === r.id)!; return { id: c.id, name: c.name, email: c.email, phone: decrypt(c.phone_enc), document: decrypt(c.document_enc), orders: r.orders, paid_cents: r.paid_cents, first_order_at: r.first_at, last_order_at: r.last_at }; }) });
  }

  // ───── Produtos e cupons ─────
  @Get('products') @ApiKey('products:read')
  async products(@Key() k: ApiKeyCtx) {
    const ps = await this.prisma.products.findMany({ where: { workspace_id: k.workspaceId, deleted_at: null }, include: { offers: { orderBy: { created_at: 'asc' } } }, orderBy: { created_at: 'desc' } });
    return toJSON({ data: ps.map(p => ({
      id: p.id, name: p.name, type: p.type, status: p.moderation_status, guarantee_days: p.guarantee_days, created_at: p.created_at,
      affiliation: { enabled: p.affiliation_enabled, commission_bps: p.affiliate_commission_bps, marketplace: p.marketplace_listed },
      offers: p.offers.map(o => ({ id: o.id, name: o.name, status: o.status, price_cents: o.price_cents, billing_type: o.billing_type, interval: o.interval, methods: o.methods, max_installments: o.max_installments, checkout_url: urls.checkout(o.slug) })),
    })), has_more: false, next_cursor: null });
  }

  @Get('coupons') @ApiKey('products:read')
  async coupons(@Key() k: ApiKeyCtx) {
    const cs = await this.prisma.coupons.findMany({ where: { workspace_id: k.workspaceId }, orderBy: { created_at: 'desc' }, take: 500 });
    return toJSON({ data: cs.map(c => this.coupon(c)), has_more: false, next_cursor: null });
  }
  private coupon(c: any) { return { id: c.id, code: c.code, kind: c.kind, value: c.value, offer_ids: c.offer_ids, ends_at: c.ends_at, max_uses: c.max_uses, max_uses_per_cpf: c.max_uses_per_cpf, uses: c.uses, active: c.active, created_at: c.created_at }; }

  @Post('coupons') @ApiKey('coupons:write')
  async createCoupon(@Key() k: ApiKeyCtx, @Body() b: any) {
    const d = parse(z.object({
      code: z.string().regex(/^[A-Za-z0-9]{3,20}$/, 'Use de 3 a 20 letras ou números.'), kind: z.enum(['percent', 'fixed']), value: z.number().int().min(1),
      offer_ids: z.array(z.string().uuid()).max(50).default([]), ends_at: z.string().datetime({ offset: true }).nullable().optional(),
      max_uses: z.number().int().min(1).nullable().optional(), max_uses_per_cpf: z.number().int().min(1).nullable().optional(),
    }), b);
    if (d.kind === 'percent' && d.value > 9000) throw new AppError('VALIDATION_ERROR', { fields: { value: 'Desconto máximo de 90% (9000 pontos-base).' } });
    if ((await this.prisma.offers.count({ where: { id: { in: d.offer_ids }, workspace_id: k.workspaceId } })) !== d.offer_ids.length) throw new AppError('NOT_FOUND');
    try {
      const c = await this.prisma.coupons.create({ data: { workspace_id: k.workspaceId, code: d.code.toUpperCase(), kind: d.kind, value: d.value, offer_ids: d.offer_ids, ends_at: d.ends_at ? new Date(d.ends_at) : null, max_uses: d.max_uses ?? null, max_uses_per_cpf: d.max_uses_per_cpf ?? null } });
      await this.audit.log({ action: 'api.coupon.create', target: `workspace:${k.workspaceId}`, after: { code: c.code, key: k.keyId } });
      return toJSON(this.coupon(c));
    } catch (e: any) {
      if (e.code === 'P2002') throw new AppError('VALIDATION_ERROR', { fields: { code: 'Já existe um cupom com este código.' } });
      throw e;
    }
  }

  @Patch('coupons/:id') @ApiKey('coupons:write')
  async updateCoupon(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) {
    uuidOr404(id);
    const d = parse(z.object({ active: z.boolean().optional(), ends_at: z.string().datetime({ offset: true }).nullable().optional(), max_uses: z.number().int().min(1).nullable().optional() }), b);
    const c = await this.prisma.coupons.findFirst({ where: { id, workspace_id: k.workspaceId } });
    if (!c) throw new AppError('NOT_FOUND');
    const u = await this.prisma.coupons.update({ where: { id }, data: { ...d, ends_at: d.ends_at === undefined ? undefined : d.ends_at ? new Date(d.ends_at) : null } });
    await this.audit.log({ action: 'api.coupon.update', target: `workspace:${k.workspaceId}`, after: { code: u.code, active: u.active, key: k.keyId } });
    return toJSON(this.coupon(u));
  }

  // ───── Afiliados ─────
  @Get('affiliates') @ApiKey('affiliates:read')
  async affiliates(@Key() k: ApiKeyCtx, @Query() q: Record<string, string>) {
    const { limit, cursor } = pageArgs(q);
    const rows = await this.prisma.affiliations.findMany({ where: { producer_workspace_id: k.workspaceId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1 });
    const p = page(rows, limit);
    const users = await this.prisma.users.findMany({ where: { id: { in: p.data.map(a => a.affiliate_user_id) } }, select: { id: true, name: true, email: true } });
    const sums = p.data.length ? await this.prisma.$queryRaw<{ ws: string; product_id: string; sales: number; cents: bigint }[]>(Prisma.sql`
      SELECT sp.beneficiary_id ws, i.product_id, COUNT(DISTINCT o.id)::int sales, SUM(sp.amount_cents)::bigint cents FROM splits sp JOIN orders o ON o.id=sp.order_id
      JOIN order_items i ON i.order_id=o.id AND i.kind='main' WHERE sp.beneficiary_type='affiliate' AND o.workspace_id=${k.workspaceId}::uuid AND o.status IN ('paid','chargeback_won')
      GROUP BY 1,2`) : [];
    return toJSON({ ...p, data: p.data.map(a => {
      const u = users.find(x => x.id === a.affiliate_user_id), s = sums.find(x => x.ws === a.affiliate_workspace_id && x.product_id === a.product_id);
      return { id: a.id, product_id: a.product_id, status: a.status, code: a.code, source: a.source, created_at: a.created_at, affiliate: { id: a.affiliate_workspace_id, name: u?.name, email: u ? maskEmail(u.email) : null }, sales: s?.sales ?? 0, commissions_cents: s?.cents ?? 0n };
    }) });
  }

  // ───── Webhooks (inscrição de Zapier, n8n e afins) ─────
  @Get('webhooks') @ApiKey('webhooks:write')
  async webhooks(@Key() k: ApiKeyCtx) {
    const eps = await this.prisma.webhook_endpoints.findMany({ where: { workspace_id: k.workspaceId, active: true }, orderBy: { created_at: 'desc' } });
    return toJSON({ data: eps.map(e => ({ id: e.id, url: e.url, events: e.events, created_at: e.created_at, created_by_api: !!e.api_key_id })), events: WEBHOOK_EVENTS, has_more: false, next_cursor: null });
  }

  @Post('webhooks') @ApiKey('webhooks:write')
  async addWebhook(@Key() k: ApiKeyCtx, @Body() b: any) {
    const d = parse(z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }), b);
    if (!(await isPublicHttpUrl(d.url))) throw new AppError('VALIDATION_ERROR', { fields: { url: 'Use um endereço https público.' } });
    if ((await this.prisma.webhook_endpoints.count({ where: { workspace_id: k.workspaceId, active: true } })) >= 50) throw new AppError('VALIDATION_ERROR', { title: 'Limite de 50 webhooks ativos por conta.' });
    const secret = `whsec_${randomToken(24)}`;
    const ep = await this.prisma.webhook_endpoints.create({ data: { workspace_id: k.workspaceId, url: d.url, events: [...d.events], secret_enc: encrypt(secret), api_key_id: k.keyId } });
    await this.audit.log({ action: 'api.webhook.create', target: `workspace:${k.workspaceId}`, after: { url: d.url, events: d.events, key: k.keyId } });
    return { id: ep.id, url: ep.url, events: ep.events, secret };
  }

  @Delete('webhooks/:id') @ApiKey('webhooks:write') @HttpCode(200)
  async delWebhook(@Key() k: ApiKeyCtx, @Param('id') id: string) {
    uuidOr404(id);
    const r = await this.prisma.webhook_endpoints.updateMany({ where: { id, workspace_id: k.workspaceId, active: true }, data: { active: false, disabled_at: new Date() } });
    if (!r.count) throw new AppError('NOT_FOUND');
    await this.audit.log({ action: 'api.webhook.delete', target: `workspace:${k.workspaceId}`, after: { id, key: k.keyId } });
    return { ok: true };
  }

  /** Exemplo de evento (mesmo formato do webhook), para montar o mapeamento de campos no Zapier/n8n. */
  @Get('events/sample') @ApiKey()
  sample(@Query('type') type = 'order.paid') {
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(type)) throw new AppError('VALIDATION_ERROR', { fields: { type: `Use um destes: ${WEBHOOK_EVENTS.join(', ')}` } });
    return [sampleEvent(type)];
  }
}
