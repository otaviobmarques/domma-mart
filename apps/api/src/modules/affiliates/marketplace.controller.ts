import { Controller, Get, Param, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { Producer, Ctx, ProducerCtx } from '../../http/context';
import { AppError } from '../../common/errors';
import { toJSON } from '../../http/json';
import { CATEGORIES, affiliateEarning, temperature, publicName } from '../../domain/marketplace';
import { urls } from '../../common/urls';

type Stat = { product_id: string; sales: number; refunds: number; views: number; affiliates: number };
/** Conversão do checkout (vendas ÷ visitas) só com visitas suficientes para o número fazer sentido. */
const conversion = (s: { sales: number; views: number }) => (s.views >= 20 && s.views >= s.sales ? Math.round((s.sales / s.views) * 1000) / 10 : null);
const PAGE = 24;

/**
 * Marketplace de afiliados (Fase 2): vitrine dos produtos que aceitam afiliados, ranking e detalhes.
 * Só entram produtos aprovados, com afiliação aberta, marcados para a vitrine pelo produtor, de contas
 * com identidade aprovada, não bloqueadas e sem saques pausados; produto retirado pelo antifraude sai.
 */
@Controller('v1/marketplace')
export class MarketplaceController {
  constructor(private prisma: PrismaService) {}

  private listedWhere(): Prisma.productsWhereInput {
    return {
      marketplace_listed: true, affiliation_enabled: true, moderation_status: 'approved', deleted_at: null, marketplace_delisted_at: null,
      workspace: { blocked_at: null, payouts_paused_at: null, kyc_status: 'approved' },
      offers: { some: { status: 'active' } },
    };
  }

  /** Vendas, reembolsos, visitas ao checkout (30 dias) e afiliados ativos de cada produto. */
  private async stats(ids: string[]): Promise<Map<string, Stat>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Stat[]>(Prisma.sql`
      SELECT p.id product_id,
        (SELECT COUNT(*)::int FROM orders o JOIN order_items i ON i.order_id=o.id AND i.kind='main' WHERE i.product_id=p.id AND o.paid_at > now() - interval '30 days') sales,
        (SELECT COUNT(*)::int FROM orders o JOIN order_items i ON i.order_id=o.id AND i.kind='main' WHERE i.product_id=p.id AND o.paid_at > now() - interval '30 days' AND o.status IN ('refunded','refund_requested','chargeback','chargeback_lost')) refunds,
        (SELECT COUNT(*)::int FROM checkout_views v JOIN offers f ON f.id=v.offer_id WHERE f.product_id=p.id AND v.created_at > now() - interval '30 days') views,
        (SELECT COUNT(*)::int FROM affiliations a WHERE a.product_id=p.id AND a.status='active') affiliates
      FROM products p WHERE p.id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))})`);
    return new Map(rows.map(r => [r.product_id, r]));
  }

  @Get() @Producer()
  async list(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>) {
    const search = (q.q ?? '').trim().slice(0, 80);
    const category = q.category && CATEGORIES[q.category] ? q.category : undefined;
    const products = await this.prisma.products.findMany({
      where: { ...this.listedWhere(), ...(category ? { category } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}) },
      include: { workspace: { select: { name: true } }, offers: { where: { status: 'active' }, orderBy: { created_at: 'asc' } } },
      take: 500,
    });
    const st = await this.stats(products.map(p => p.id));
    const mine = await this.prisma.affiliations.findMany({ where: { affiliate_workspace_id: c.workspaceId, product_id: { in: products.map(p => p.id) } } });
    let rows = products.map(p => {
      const o = p.offers[0];
      const bps = Math.max(p.affiliate_commission_bps, ...p.offers.map(x => x.affiliate_commission_bps ?? 0));
      const s = st.get(p.id) ?? { sales: 0, refunds: 0, views: 0, affiliates: 0 };
      return {
        product_id: p.id, name: p.name, cover_url: p.cover_url, type: p.type, category: p.category, category_label: CATEGORIES[p.category ?? ''] ?? null,
        producer: p.workspace.name, price_cents: o.price_cents, billing_type: o.billing_type,
        commission_bps: p.affiliate_commission_bps, max_commission_bps: bps,
        earning_cents: affiliateEarning(o.price_cents, o.affiliate_commission_bps ?? p.affiliate_commission_bps),
        temperature: temperature(s.sales), sales_30d: s.sales, conversion_pct: conversion(s),
        refund_pct: s.sales ? Math.round((s.refunds / s.sales) * 1000) / 10 : 0, affiliates: s.affiliates,
        guarantee_days: p.guarantee_days, cookie_days: p.affiliate_cookie_days, attribution: p.affiliate_attribution, auto_approve: p.affiliation_auto_approve,
        published_at: p.published_at, own: p.workspace_id === c.workspaceId, my_status: mine.find(m => m.product_id === p.id)?.status ?? null,
      };
    });
    const sort = q.sort ?? 'hot';
    const by: Record<string, (a: typeof rows[0], b: typeof rows[0]) => number> = {
      hot: (a, b) => b.temperature - a.temperature || b.sales_30d - a.sales_30d,
      commission: (a, b) => Number(b.earning_cents - a.earning_cents),
      new: (a, b) => (b.published_at?.getTime() ?? 0) - (a.published_at?.getTime() ?? 0),
      price: (a, b) => Number(a.price_cents - b.price_cents),
    };
    rows = rows.sort(by[sort] ?? by.hot);
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    return toJSON({ total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / PAGE)), items: rows.slice((page - 1) * PAGE, page * PAGE), categories: CATEGORIES });
  }

  /** Ranking dos afiliados do mês (comissões de vendas pagas). Nome público: primeiro nome + inicial. */
  @Get('ranking') @Producer()
  async ranking(@Ctx() c: ProducerCtx, @Query('product_id') productId?: string) {
    return toJSON(await this.rank(c.workspaceId, productId));
  }

  private async rank(me: string, productId?: string) {
    const start = new Date(); start.setUTCDate(1); start.setUTCHours(3, 0, 0, 0); // mês corrente (Brasília)
    if (start > new Date()) start.setUTCMonth(start.getUTCMonth() - 1);
    const rows = await this.prisma.$queryRaw<{ ws: string; name: string; sales: number; cents: bigint }[]>(Prisma.sql`
      SELECT sp.beneficiary_id ws, w.name, COUNT(DISTINCT o.id)::int sales, SUM(sp.amount_cents)::bigint cents
      FROM splits sp JOIN orders o ON o.id=sp.order_id JOIN workspaces w ON w.id=sp.beneficiary_id
      ${productId ? Prisma.sql`JOIN order_items i ON i.order_id=o.id AND i.kind='main' AND i.product_id=${productId}::uuid` : Prisma.empty}
      WHERE sp.beneficiary_type='affiliate' AND o.paid_at >= ${start} AND o.status IN ('paid','chargeback_won')
      GROUP BY 1,2 ORDER BY cents DESC LIMIT 200`);
    const pos = rows.findIndex(r => r.ws === me);
    return {
      since: start,
      top: rows.slice(0, 20).map((r, i) => ({ position: i + 1, name: publicName(r.name), sales: r.sales, me: r.ws === me, ...(r.ws === me ? { commissions_cents: r.cents } : {}) })),
      me: pos >= 0 ? { position: pos + 1, sales: rows[pos].sales, commissions_cents: rows[pos].cents } : null,
    };
  }

  @Get(':productId') @Producer()
  async detail(@Ctx() c: ProducerCtx, @Param('productId') productId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new AppError('NOT_FOUND');
    const p = await this.prisma.products.findFirst({ where: { id: productId, ...this.listedWhere() }, include: { workspace: { select: { name: true } }, offers: { where: { status: 'active' }, orderBy: { created_at: 'asc' } } } });
    if (!p) throw new AppError('NOT_FOUND');
    const s = (await this.stats([p.id])).get(p.id)!;
    const mine = await this.prisma.affiliations.findUnique({ where: { product_id_affiliate_workspace_id: { product_id: p.id, affiliate_workspace_id: c.workspaceId } } });
    const active = mine?.status === 'active';
    return toJSON({
      product_id: p.id, name: p.name, description: p.description, cover_url: p.cover_url, type: p.type, category_label: CATEGORIES[p.category ?? ''] ?? null,
      producer: p.workspace.name, guarantee_days: p.guarantee_days, cookie_days: p.affiliate_cookie_days, attribution: p.affiliate_attribution,
      auto_approve: p.affiliation_auto_approve, rules: p.affiliate_rules,
      temperature: temperature(s.sales), sales_30d: s.sales, conversion_pct: conversion(s),
      refund_pct: s.sales ? Math.round((s.refunds / s.sales) * 1000) / 10 : 0, affiliates: s.affiliates,
      offers: p.offers.map(o => {
        const bps = o.affiliate_commission_bps ?? p.affiliate_commission_bps;
        return { offer_id: o.id, name: o.name, price_cents: o.price_cents, billing_type: o.billing_type, interval: o.interval, commission_bps: bps, earning_cents: affiliateEarning(o.price_cents, bps), checkout_url: urls.checkout(o.slug), link: active ? `${process.env.APP_URL || ''}/r/${mine!.code}/${o.slug}` : null };
      }),
      own: p.workspace_id === c.workspaceId,
      my_affiliation: mine && { status: mine.status, code: mine.code },
      materials: active ? await this.prisma.affiliate_materials.findMany({ where: { product_id: p.id }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] }) : null,
      ranking: await this.rank(c.workspaceId, p.id),
    });
  }
}
