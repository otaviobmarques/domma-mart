import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { Producer, Ctx, ProducerCtx } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { base62 } from '../../common/crypto';
import { toJSON } from '../../http/json';
import { urls } from '../../common/urls';
import { compare, missingVisitors, Arm } from '../../domain/abtest';

/**
 * Teste A/B do checkout (Fase 2). Cada versão é uma oferta do produto: a B costuma ser uma cópia da A
 * com uma mudança (preço, parcelas, visual, oferta especial, upsell). Os visitantes do link da oferta A
 * são divididos; cada um vê sempre a mesma versão.
 */
@Controller('v1')
export class ExperimentsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async ownProduct(c: ProducerCtx, id: string) {
    const p = await this.prisma.products.findFirst({ where: { id, workspace_id: c.workspaceId, deleted_at: null } });
    if (!p) throw new AppError('NOT_FOUND');
    return p;
  }
  private async ownExp(c: ProducerCtx, id: string) {
    const e = await this.prisma.checkout_experiments.findFirst({ where: { id, workspace_id: c.workspaceId } });
    if (!e) throw new AppError('NOT_FOUND');
    return e;
  }

  /** Duplicar oferta: mesma configuração (visual, pixels, oferta especial, upsell, comissão), novo link. Base para a versão B. */
  @Post('offers/:id/duplicate') @Producer('products.edit')
  async duplicate(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60).optional() }), b ?? {});
    const o = await this.prisma.offers.findFirst({ where: { id, workspace_id: c.workspaceId }, include: { bumps: true, product: true } });
    if (!o || o.product.deleted_at) throw new AppError('NOT_FOUND');
    if ((await this.prisma.offers.count({ where: { product_id: o.product_id } })) >= 20) throw new AppError('VALIDATION_ERROR', { title: 'Limite de 20 ofertas por produto.' });
    const { id: _id, slug: _s, created_at: _c, updated_at: _u, bumps, product, name: oldName, ...rest } = o;
    const copy = await this.prisma.$transaction(async (tx) => {
      const n = await tx.offers.create({ data: { ...rest, theme: (o.theme ?? undefined) as any, slug: base62(8), name: name ?? `${oldName === 'Padrão' ? 'Oferta' : oldName} (versão B)`.slice(0, 60), status: o.status === 'ended' ? 'active' : o.status } });
      if (bumps.length) await tx.offer_bumps.createMany({ data: bumps.map(x => ({ offer_id: n.id, bump_offer_id: x.bump_offer_id, headline: x.headline, position: x.position })) });
      return n;
    });
    await this.audit.log({ actorId: c.userId, action: 'offer.duplicate', target: `offer:${copy.id}`, after: { from: id } });
    return toJSON({ ...copy, checkout_url: urls.checkout(copy.slug) });
  }

  /** Números de cada versão: visitantes únicos, checkouts iniciados, vendas pagas (sem reembolso), receita. */
  private async arms(expId: string): Promise<Record<'a' | 'b', Arm & { views: number; orders: number; refunds: number }>> {
    const v = await this.prisma.$queryRaw<{ variant: string; visitors: number; views: number }[]>(Prisma.sql`
      SELECT variant, COUNT(DISTINCT visitor)::int visitors, COUNT(*)::int views FROM checkout_views WHERE experiment_id=${expId}::uuid GROUP BY 1`);
    const o = await this.prisma.$queryRaw<{ variant: string; orders: number; sales: number; refunds: number; revenue: bigint; revenue_sq: number }[]>(Prisma.sql`
      SELECT experiment_variant variant, COUNT(*)::int orders,
        COUNT(*) FILTER (WHERE paid_at IS NOT NULL AND status IN ('paid','chargeback_won','refund_requested'))::int sales,
        COUNT(*) FILTER (WHERE status IN ('refunded','chargeback','chargeback_lost'))::int refunds,
        COALESCE(SUM(total_cents) FILTER (WHERE paid_at IS NOT NULL AND status IN ('paid','chargeback_won','refund_requested')),0)::bigint revenue,
        COALESCE(SUM((total_cents::float8)^2) FILTER (WHERE paid_at IS NOT NULL AND status IN ('paid','chargeback_won','refund_requested')),0)::float8 revenue_sq
      FROM orders WHERE experiment_id=${expId}::uuid GROUP BY 1`);
    const one = (k: 'a' | 'b') => {
      const x = v.find(r => r.variant === k), y = o.find(r => r.variant === k);
      return { visitors: x?.visitors ?? 0, views: x?.views ?? 0, orders: y?.orders ?? 0, sales: y?.sales ?? 0, refunds: y?.refunds ?? 0, revenue: Number(y?.revenue ?? 0), revenueSq: y?.revenue_sq ?? 0 };
    };
    return { a: one('a'), b: one('b') };
  }

  private async present(e: Awaited<ReturnType<ExperimentsController['ownExp']>>) {
    const offers = await this.prisma.offers.findMany({ where: { id: { in: [e.control_offer_id, e.variant_offer_id] } } });
    const arms = await this.arms(e.id);
    const res = compare(arms.a, arms.b, e.metric as 'conversion' | 'revenue');
    const side = (k: 'a' | 'b', offerId: string) => {
      const o = offers.find(x => x.id === offerId), a = arms[k];
      return { offer_id: offerId, name: o?.name, price_cents: o?.price_cents, checkout_url: o ? urls.checkout(o.slug) : null, ...a,
        conversion_pct: a.visitors ? Math.round((a.sales / a.visitors) * 10000) / 100 : 0, revenue_per_visitor_cents: a.visitors ? Math.round(a.revenue / a.visitors) : 0, avg_ticket_cents: a.sales ? Math.round(a.revenue / a.sales) : 0 };
    };
    return {
      id: e.id, name: e.name, status: e.status, winner: e.winner, split_pct: e.split_pct, metric: e.metric, started_at: e.started_at, ended_at: e.ended_at,
      a: side('a', e.control_offer_id), b: side('b', e.variant_offer_id),
      result: { ...res, lift_pct: res.lift == null ? null : Math.round(res.lift * 1000) / 10, missing_visitors: missingVisitors(arms.a, arms.b) },
    };
  }

  @Get('products/:id/experiments') @Producer('products.edit')
  async list(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    await this.ownProduct(c, id);
    const es = await this.prisma.checkout_experiments.findMany({ where: { product_id: id }, orderBy: { created_at: 'desc' }, take: 20 });
    return toJSON(await Promise.all(es.map(e => this.present(e))));
  }

  @Post('products/:id/experiments') @Producer('products.edit')
  async create(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const p = await this.ownProduct(c, id);
    const d = parse(z.object({
      name: z.string().trim().min(2).max(80), control_offer_id: z.string().uuid(), variant_offer_id: z.string().uuid(),
      split_pct: z.number().int().min(10).max(90).default(50), metric: z.enum(['conversion', 'revenue']).default('conversion'),
    }), b);
    if (d.control_offer_id === d.variant_offer_id) throw new AppError('VALIDATION_ERROR', { fields: { variant_offer_id: 'Escolha outra oferta para a versão B.' } });
    const offers = await this.prisma.offers.findMany({ where: { id: { in: [d.control_offer_id, d.variant_offer_id] }, product_id: p.id } });
    const A = offers.find(o => o.id === d.control_offer_id), B = offers.find(o => o.id === d.variant_offer_id);
    if (!A || !B) throw new AppError('VALIDATION_ERROR', { fields: { variant_offer_id: 'As duas versões precisam ser ofertas deste produto.' } });
    if (A.status !== 'active' || B.status !== 'active') throw new AppError('VALIDATION_ERROR', { fields: { variant_offer_id: 'As duas ofertas precisam estar à venda.' } });
    if (A.billing_type !== B.billing_type) throw new AppError('VALIDATION_ERROR', { fields: { variant_offer_id: 'Compare ofertas do mesmo tipo (pagamento único com pagamento único, assinatura com assinatura).' } });
    const busy = await this.prisma.checkout_experiments.findFirst({ where: { status: { in: ['running', 'paused'] }, OR: [{ control_offer_id: { in: [A.id, B.id] } }, { variant_offer_id: { in: [A.id, B.id] } }] } });
    if (busy) throw new AppError('VALIDATION_ERROR', { title: `Uma destas ofertas já está no teste “${busy.name}”. Encerre-o antes.` });
    const e = await this.prisma.checkout_experiments.create({ data: { workspace_id: c.workspaceId, product_id: p.id, control_offer_id: A.id, variant_offer_id: B.id, name: d.name, split_pct: d.split_pct, metric: d.metric, created_by: c.userId } });
    await this.audit.log({ actorId: c.userId, action: 'experiment.start', target: `experiment:${e.id}`, after: { a: A.id, b: B.id, split: d.split_pct, metric: d.metric } });
    return toJSON(await this.present(e));
  }

  /** Pausar (todos veem A, nada é contado), retomar, ou encerrar escolhendo a vencedora. */
  @Post('experiments/:id/:action') @Producer('products.edit') @HttpCode(200)
  async act(@Ctx() c: ProducerCtx, @Param('id') id: string, @Param('action') action: string, @Body() b: any) {
    const e = await this.ownExp(c, id);
    if (e.status === 'ended') throw new AppError('CONFLICT', { title: 'Este teste já foi encerrado.' });
    let data: Prisma.checkout_experimentsUpdateInput;
    if (action === 'pause') data = { status: 'paused' };
    else if (action === 'resume') data = { status: 'running' };
    else if (action === 'end') {
      const { winner } = parse(z.object({ winner: z.enum(['a', 'b']) }), b);
      data = { status: 'ended', winner, ended_at: new Date() };
    } else throw new AppError('NOT_FOUND');
    const u = await this.prisma.checkout_experiments.update({ where: { id }, data });
    await this.audit.log({ actorId: c.userId, action: `experiment.${action}`, target: `experiment:${id}`, after: { status: u.status, winner: u.winner } });
    return toJSON(await this.present(u));
  }
}
