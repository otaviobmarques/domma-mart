import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { Producer, Ctx, ProducerCtx } from '../../http/context';
import { AppError } from '../../common/errors';
import { toJSON } from '../../http/json';
import { lastMonths, customerCohorts, subscriptionSeries, subscriptionCohorts, subscriptionSummary, CohortCell, Sub } from '../../domain/reports';

const TZ = 'America/Sao_Paulo';
/** Vendas que contam: pagas e não reembolsadas/perdidas em contestação. */
const VALID = Prisma.sql`o.paid_at IS NOT NULL AND o.status NOT IN ('refunded','chargeback_lost','chargeback')`;

function args(q: Record<string, string>) {
  const months = Math.max(3, Math.min(24, Math.floor(Number(q.months) || 12)));
  if (q.product_id && !/^[0-9a-f-]{36}$/i.test(q.product_id)) throw new AppError('VALIDATION_ERROR', { fields: { product_id: 'Produto inválido.' } });
  return { months, productId: q.product_id || null };
}
const csv = (rows: (string | number | null)[][]) => '﻿' + rows.map(r => r.map(v => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n');

/** Relatórios de retenção, LTV e cancelamento (Fase 2). */
@Controller('v1/reports')
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  private async customerData(ws: string, months: number, productId: string | null) {
    const prod = productId ? Prisma.sql`AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.product_id=${productId}::uuid)` : Prisma.empty;
    // primeira compra de cada cliente na conta (com o produto, se filtrado): define a coorte, o canal e o produto de entrada
    const cells = await this.prisma.$queryRaw<{ cohort: string; k: number; customers: number; revenue: bigint }[]>(Prisma.sql`
      WITH paid AS (SELECT o.customer_id, o.paid_at, o.total_cents FROM orders o WHERE o.workspace_id=${ws}::uuid AND ${VALID} ${prod}),
      first AS (SELECT customer_id, MIN(paid_at) f FROM paid GROUP BY 1)
      SELECT to_char(date_trunc('month', f.f AT TIME ZONE ${TZ}), 'YYYY-MM') cohort,
        ((EXTRACT(YEAR FROM date_trunc('month', p.paid_at AT TIME ZONE ${TZ})) - EXTRACT(YEAR FROM date_trunc('month', f.f AT TIME ZONE ${TZ}))) * 12
          + EXTRACT(MONTH FROM date_trunc('month', p.paid_at AT TIME ZONE ${TZ})) - EXTRACT(MONTH FROM date_trunc('month', f.f AT TIME ZONE ${TZ})))::int k,
        COUNT(DISTINCT p.customer_id)::int customers, SUM(p.total_cents)::bigint revenue
      FROM paid p JOIN first f ON f.customer_id=p.customer_id
      WHERE f.f >= (date_trunc('month', now() AT TIME ZONE ${TZ}) - make_interval(months => ${months - 1}::int)) AT TIME ZONE ${TZ}
      GROUP BY 1,2`);
    const [sum] = await this.prisma.$queryRaw<{ customers: number; repeat: number; orders: number; revenue: bigint; days_to_second: number | null }[]>(Prisma.sql`
      WITH paid AS (SELECT o.customer_id, o.paid_at, o.total_cents, ROW_NUMBER() OVER (PARTITION BY o.customer_id ORDER BY o.paid_at) n FROM orders o WHERE o.workspace_id=${ws}::uuid AND ${VALID} ${prod}),
      per AS (SELECT customer_id, COUNT(*) orders, SUM(total_cents) revenue,
        EXTRACT(EPOCH FROM (MIN(paid_at) FILTER (WHERE n=2) - MIN(paid_at) FILTER (WHERE n=1))) / 86400 d2 FROM paid GROUP BY 1)
      SELECT COUNT(*)::int customers, COUNT(*) FILTER (WHERE orders >= 2)::int repeat, COALESCE(SUM(orders),0)::int orders, COALESCE(SUM(revenue),0)::bigint revenue,
        (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d2))::float8 days_to_second FROM per`);
    // canal (UTM da primeira compra) e produto de entrada: quem traz cliente que vale mais
    const entry = await this.prisma.$queryRaw<{ dim: string; key: string; customers: number; repeat: number; revenue: bigint }[]>(Prisma.sql`
      WITH paid AS (SELECT o.id, o.customer_id, o.paid_at, o.total_cents, o.tracking FROM orders o WHERE o.workspace_id=${ws}::uuid AND ${VALID} ${prod}),
      first AS (SELECT DISTINCT ON (customer_id) customer_id, id, COALESCE(NULLIF(tracking->>'utm_source',''),'(direto)') src FROM paid ORDER BY customer_id, paid_at),
      fprod AS (SELECT f.customer_id, COALESCE(pr.name,'—') prod FROM first f JOIN order_items i ON i.order_id=f.id AND i.kind='main' LEFT JOIN products pr ON pr.id=i.product_id),
      per AS (SELECT customer_id, COUNT(*) n, SUM(total_cents) revenue FROM paid GROUP BY 1)
      SELECT 'source' dim, f.src key, COUNT(*)::int customers, COUNT(*) FILTER (WHERE per.n>=2)::int repeat, SUM(per.revenue)::bigint revenue FROM first f JOIN per USING (customer_id) GROUP BY 2
      UNION ALL
      SELECT 'product', fp.prod, COUNT(*)::int, COUNT(*) FILTER (WHERE per.n>=2)::int, SUM(per.revenue)::bigint FROM fprod fp JOIN per USING (customer_id) GROUP BY 2`);
    const months_ = lastMonths(months);
    const cohorts = customerCohorts(cells.map(c => ({ ...c, revenue: Number(c.revenue) })) as CohortCell[], months_);
    const table = (dim: string) => entry.filter(e => e.dim === dim).map(e => ({ key: e.key, customers: e.customers, repeat_pct: e.customers ? Math.round((e.repeat / e.customers) * 1000) / 10 : 0, ltv_cents: e.customers ? Math.round(Number(e.revenue) / e.customers) : 0, revenue_cents: Number(e.revenue) }))
      .sort((a, b) => b.revenue_cents - a.revenue_cents).slice(0, 15);
    return {
      summary: {
        customers: sum.customers, repeat_customers: sum.repeat, repeat_pct: sum.customers ? Math.round((sum.repeat / sum.customers) * 1000) / 10 : 0,
        orders_per_customer: sum.customers ? Math.round((sum.orders / sum.customers) * 100) / 100 : 0,
        ltv_cents: sum.customers ? Math.round(Number(sum.revenue) / sum.customers) : 0, revenue_cents: Number(sum.revenue),
        median_days_to_second: sum.days_to_second == null ? null : Math.round(sum.days_to_second),
      },
      cohorts, by_source: table('source'), by_product: table('product'),
    };
  }

  @Get('customers') @Producer('orders.view')
  async customers(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>) {
    const { months, productId } = args(q);
    return toJSON(await this.customerData(c.workspaceId, months, productId));
  }

  @Get('customers.csv') @Producer('orders.view')
  async customersCsv(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>, @Res() res: Response) {
    const { months, productId } = args(q);
    const d = await this.customerData(c.workspaceId, months, productId);
    const head = ['coorte', 'clientes', ...Array.from({ length: 12 }, (_, k) => `retencao_m${k}_%`), ...Array.from({ length: 12 }, (_, k) => `ltv_m${k}_reais`)];
    const rows = d.cohorts.map(r => [r.cohort, r.customers, ...r.retention, ...r.ltv_cents.map(v => (v == null ? null : (v / 100).toFixed(2)))]);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="coortes-clientes.csv"' }).send(csv([head, ...rows]));
  }

  private async subData(ws: string, months: number, productId: string | null) {
    const rows = await this.prisma.$queryRaw<(Sub & { price_cents: bigint })[]>(Prisma.sql`
      SELECT s.created_at, s.ended_at, s.end_reason, s.price_cents, o.interval, s.status, s.cancel_requested_at
      FROM subscriptions s JOIN offers o ON o.id=s.offer_id
      WHERE s.workspace_id=${ws}::uuid ${productId ? Prisma.sql`AND o.product_id=${productId}::uuid` : Prisma.empty}
      LIMIT 100000`);
    const subs: Sub[] = rows.map(r => ({ ...r, price_cents: Number(r.price_cents) }));
    const m = lastMonths(months);
    const series = subscriptionSeries(subs, m);
    return { summary: subscriptionSummary(subs, series), series, cohorts: subscriptionCohorts(subs, m), total: subs.length };
  }

  @Get('subscriptions') @Producer('orders.view')
  async subscriptions(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>) {
    const { months, productId } = args(q);
    return toJSON(await this.subData(c.workspaceId, months, productId));
  }

  @Get('subscriptions.csv') @Producer('orders.view')
  async subscriptionsCsv(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>, @Res() res: Response) {
    const { months, productId } = args(q);
    const d = await this.subData(c.workspaceId, months, productId);
    const head = ['mes', 'ativas_no_inicio', 'novas', 'encerradas', 'cancelou', 'falha_pagamento', 'reembolso', 'churn_%', 'mrr_reais'];
    const rows = d.series.map(s => [s.month, s.active_start, s.new, s.ended, s.voluntary, s.payment_failed, s.refund, s.churn_pct, (s.mrr_cents / 100).toFixed(2)]);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="assinaturas-mensal.csv"' }).send(csv([head, ...rows]));
  }
}
