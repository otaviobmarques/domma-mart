import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { OrdersService } from '../orders/orders.service';
import { RiskService, deviceKey, binKey } from './risk.service';
import { Admin, Ctx, ProducerCtx } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { blindIndex, decrypt } from '../../common/crypto';
import { maskDocument, maskEmail } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { RULE_KEYS, RULE_INFO, validBands, DEFAULT_RISK } from '../../domain/risk';

const Reason = z.string().min(10, 'Explique o motivo (mín. 10 caracteres).').max(1000);
const Rule = z.object({
  enabled: z.boolean(), points: z.number().int().min(0).max(200),
  max: z.number().int().min(1).max(1000).optional(), window_min: z.number().int().min(1).max(10080).optional(),
  amount_cents: z.number().int().min(500).max(100_000_000).optional(), from_h: z.number().int().min(0).max(23).optional(),
  to_h: z.number().int().min(0).max(23).optional(), weight: z.number().min(0).max(2).optional(),
});
const Config = z.object({
  bands: z.object({ three_ds: z.number().int(), review: z.number().int(), decline: z.number().int() }),
  rules: z.object(Object.fromEntries(RULE_KEYS.map(k => [k, Rule])) as Record<(typeof RULE_KEYS)[number], typeof Rule>),
  reserve: z.object({ new_account_pct: z.number().int().min(0).max(50), new_account_days: z.number().int().min(1).max(180), account_age_days: z.number().int().min(0).max(365), min_paid_orders: z.number().int().min(0).max(10000) }),
  producer: z.object({ alert_pct: z.number().min(0.1).max(20), review_pct: z.number().min(0.1).max(20), pause_pct: z.number().min(0.1).max(20), min_orders: z.number().int().min(1).max(10000) }),
  reason: Reason,
});
const BLOCK_KINDS = ['cpf', 'email', 'email_domain', 'ip', 'device', 'bin'] as const;

/** Back-office › Antifraude (Fase 2): fila de revisão, alertas, regras e faixas, lista de bloqueio. */
@Controller('v1/admin')
export class RiskController {
  constructor(private prisma: PrismaService, private audit: AuditService, private ledger: LedgerService, private orders: OrdersService, private risk: RiskService) {}

  @Get('fraud/overview') @Admin('risk.manage')
  async overview() {
    const by = await this.prisma.$queryRaw<{ decision: string; n: number }[]>(Prisma.sql`SELECT decision, COUNT(*)::int n FROM risk_assessments WHERE created_at > now() - interval '24 hours' GROUP BY 1`);
    const [reviews, alerts, held] = await Promise.all([
      this.prisma.risk_assessments.count({ where: { review_status: 'open' } }),
      this.prisma.risk_alerts.count({ where: { acknowledged_at: null } }),
      this.prisma.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(amount_cents)::bigint s FROM risk_assessments WHERE review_status='open'`,
    ]);
    return toJSON({ last_24h: Object.fromEntries(by.map(r => [r.decision, r.n])), open_reviews: reviews, open_alerts: alerts, held_cents: held[0].s ?? 0n });
  }

  // ───── Fila de revisão ─────
  @Get('fraud/reviews') @Admin('risk.manage')
  async reviews(@Query('status') status = 'open') {
    const rows = await this.prisma.risk_assessments.findMany({ where: { review_status: status }, orderBy: { created_at: status === 'open' ? 'asc' : 'desc' }, take: 100 });
    const orders = await this.prisma.orders.findMany({ where: { id: { in: rows.map(r => r.order_id).filter(Boolean) as string[] } }, include: { items: true, payments: { orderBy: { created_at: 'desc' }, take: 1 } } });
    const customers = await this.prisma.customers.findMany({ where: { id: { in: orders.map(o => o.customer_id) } } });
    const ws = await this.prisma.workspaces.findMany({ where: { id: { in: rows.map(r => r.workspace_id) } }, select: { id: true, name: true } });
    const products = await this.prisma.products.findMany({ where: { id: { in: orders.flatMap(o => o.items.map(i => i.product_id)) } }, select: { id: true, name: true } });
    return toJSON(rows.map(r => {
      const o = orders.find(x => x.id === r.order_id), cu = o && customers.find(c => c.id === o.customer_id), p = o?.payments[0];
      return {
        id: r.id, created_at: r.created_at, score: r.score, gateway_score: r.gateway_score, decision: r.decision, signals: r.signals, review_status: r.review_status, review_reason: r.review_reason, reviewed_at: r.reviewed_at,
        account: ws.find(w => w.id === r.workspace_id)?.name, amount_cents: r.amount_cents,
        order: o && { id: o.id, code: o.code, status: o.status, installments: o.installments, product: products.find(x => x.id === o.items.find(i => i.kind === 'main')?.product_id)?.name },
        buyer: cu && { name: cu.name, email: maskEmail(cu.email), document: maskDocument(decrypt(cu.document_enc)) },
        card: p && { brand: p.card_brand, last4: p.card_last4 },
      };
    }));
  }

  /** Aprovar: o dinheiro volta ao saldo do produtor, nas datas originais. */
  @Post('fraud/reviews/:id/approve') @Admin('risk.manage') @HttpCode(200)
  async approve(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const { reason } = parse(z.object({ reason: Reason }), b);
    const a = await this.open(id);
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.orders.findUniqueOrThrow({ where: { id: a.order_id! } });
      await this.ledger.releaseOrderHold(tx, o.id, o.code);
      await tx.risk_assessments.update({ where: { id }, data: { review_status: 'approved', reviewed_by: c.userId, reviewed_at: new Date(), review_reason: reason } });
      await this.audit.log({ actorId: c.userId, action: 'fraud.review.approve', target: `order:${o.id}`, after: { score: a.score }, reason }, tx);
    });
    return { ok: true };
  }

  /** Recusar: devolve o dinheiro ao comprador e, se pedido, bloqueia CPF, e-mail, aparelho e IP da compra. */
  @Post('fraud/reviews/:id/reject') @Admin('risk.manage') @HttpCode(200)
  async reject(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const d = parse(z.object({ reason: Reason, block: z.array(z.enum(['cpf', 'email', 'device', 'ip'])).max(4).default([]) }), b);
    const a = await this.open(id);
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id: a.order_id! } });
    if (o.status === 'paid') await this.orders.refund(o.id, 'platform', { actorId: c.userId, reason: `Antifraude: ${d.reason}` });
    // mesmas chaves que o checkout consulta (o aparelho vem do valor gravado no pedido)
    const hashes: Record<string, string | null> = { cpf: a.doc_hash, email: a.email_hash, ip: a.ip_hash, device: o.device_fingerprint ? deviceKey(o.device_fingerprint) : null };
    for (const k of d.block) {
      const h = hashes[k];
      if (!h) continue;
      await this.prisma.blocklist.upsert({ where: { kind_value_hash: { kind: k, value_hash: h } }, create: { kind: k, value_hash: h, reason: `Antifraude (pedido ${o.code}): ${d.reason}`, label: `pedido ${o.code}`, created_by: c.userId }, update: {} });
    }
    await this.prisma.risk_assessments.update({ where: { id }, data: { review_status: 'rejected', reviewed_by: c.userId, reviewed_at: new Date(), review_reason: d.reason } });
    await this.audit.log({ actorId: c.userId, action: 'fraud.review.reject', target: `order:${o.id}`, after: { blocked: d.block, refunded: o.status === 'paid' }, reason: d.reason });
    return { ok: true, refunded: o.status === 'paid' };
  }

  private async open(id: string) {
    const a = await this.prisma.risk_assessments.findUnique({ where: { id } });
    if (!a || !a.order_id) throw new AppError('NOT_FOUND');
    if (a.review_status !== 'open') throw new AppError('CONFLICT', { title: 'Esta revisão já foi decidida.' });
    return a;
  }

  /** Últimas avaliações (inclui recusadas sem pedido). */
  @Get('fraud/assessments') @Admin('risk.manage')
  async assessments(@Query('decision') decision?: string) {
    const rows = await this.prisma.risk_assessments.findMany({ where: decision ? { decision } : {}, orderBy: { created_at: 'desc' }, take: 200 });
    const ws = await this.prisma.workspaces.findMany({ where: { id: { in: rows.map(r => r.workspace_id) } }, select: { id: true, name: true } });
    return toJSON(rows.map(r => ({ id: r.id, created_at: r.created_at, account: ws.find(w => w.id === r.workspace_id)?.name, amount_cents: r.amount_cents, score: r.score, gateway_score: r.gateway_score, decision: r.decision, review_status: r.review_status, signals: r.signals, has_order: !!r.order_id })));
  }

  // ───── Alertas ─────
  @Get('fraud/alerts') @Admin('risk.manage')
  async alerts(@Query('all') all?: string) {
    return toJSON(await this.prisma.risk_alerts.findMany({ where: all ? {} : { acknowledged_at: null }, orderBy: { created_at: 'desc' }, take: 100 }));
  }

  @Post('fraud/alerts/:id/ack') @Admin('risk.manage') @HttpCode(200)
  async ack(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    await this.prisma.risk_alerts.updateMany({ where: { id, acknowledged_at: null }, data: { acknowledged_at: new Date(), acknowledged_by: c.userId } });
    return { ok: true };
  }

  // ───── Regras e faixas ─────
  @Get('fraud/config') @Admin('risk.manage')
  async getConfig() {
    return { config: await this.risk.config(), defaults: DEFAULT_RISK, info: RULE_INFO };
  }

  @Put('fraud/config') @Admin('risk.manage')
  async putConfig(@Ctx() c: ProducerCtx, @Body() b: any) {
    const { reason, ...cfg } = parse(Config, b);
    if (!validBands(cfg.bands)) throw new AppError('VALIDATION_ERROR', { fields: { bands: 'As faixas precisam crescer: 3-D Secure < revisão < recusa (máx. 300).' } });
    if (!(cfg.producer.alert_pct <= cfg.producer.review_pct && cfg.producer.review_pct <= cfg.producer.pause_pct)) throw new AppError('VALIDATION_ERROR', { fields: { producer: 'Os limites de chargeback precisam crescer: alerta ≤ revisão ≤ pausa.' } });
    const before = await this.risk.config();
    await this.prisma.risk_config.upsert({ where: { key: 'config' }, create: { key: 'config', value: cfg as any, updated_by: c.userId }, update: { value: cfg as any, updated_by: c.userId, updated_at: new Date() } });
    this.risk.invalidate();
    await this.audit.log({ actorId: c.userId, action: 'fraud.config', target: 'risk_config:config', before, after: cfg, reason });
    return { config: await this.risk.config() };
  }

  // ───── Risco do produtor (RN-55) ─────
  @Get('risk') @Admin('risk.manage')
  async producers() { return this.risk.producerRates(); }

  /** Roda agora a verificação diária de chargeback dos produtores. */
  @Post('fraud/scan-producers') @Admin('risk.manage') @HttpCode(200)
  async scan() { return this.risk.scanProducers(); }

  @Post('accounts/:id/payouts') @Admin('risk.manage') @HttpCode(200)
  async payouts(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const d = parse(z.object({ paused: z.boolean(), reason: Reason }), b);
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id } });
    await this.prisma.workspaces.update({ where: { id }, data: { payouts_paused_at: d.paused ? new Date() : null, payouts_paused_reason: d.paused ? d.reason : null } });
    await this.audit.log({ actorId: c.userId, action: d.paused ? 'account.payouts_paused' : 'account.payouts_resumed', target: `workspace:${id}`, before: { paused: !!ws.payouts_paused_at }, after: { paused: d.paused }, reason: d.reason });
    return { ok: true };
  }

  // ───── Lista de bloqueio (RN-62) ─────
  @Get('blocklist') @Admin('risk.manage')
  async blocklist(@Query('kind') kind?: string) {
    const rows = await this.prisma.blocklist.findMany({ where: kind ? { kind } : {}, orderBy: { created_at: 'desc' }, take: 300 });
    return toJSON(rows.map(r => ({ id: r.id, kind: r.kind, label: r.label, reason: r.reason, expires_at: r.expires_at, created_at: r.created_at, expired: !!r.expires_at && r.expires_at < new Date() })));
  }

  @Post('blocklist') @Admin('risk.manage')
  async addBlock(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ kind: z.enum(BLOCK_KINDS), value: z.string().min(3).max(200), reason: Reason, days: z.number().int().min(1).max(3650).optional() }), b);
    const v = d.value.trim();
    let hash: string, label: string;
    switch (d.kind) {
      case 'cpf': { const x = v.replace(/\D/g, ''); if (x.length !== 11 && x.length !== 14) throw new AppError('VALIDATION_ERROR', { fields: { value: 'CPF ou CNPJ só com números.' } }); hash = blindIndex(x); label = maskDocument(x); break; }
      case 'email': hash = blindIndex(v.toLowerCase()); label = maskEmail(v.toLowerCase()); break;
      case 'email_domain': hash = blindIndex(v.toLowerCase().replace(/^@/, '')); label = v.toLowerCase().replace(/^@/, ''); break;
      case 'ip': hash = blindIndex(`ip:${v}`); label = v.replace(/\.\d+$/, '.*'); break;
      case 'device': hash = deviceKey(v); label = `aparelho ${v.slice(0, 6)}…`; break;
      case 'bin': { if (!/^\d{6,8}$/.test(v)) throw new AppError('VALIDATION_ERROR', { fields: { value: 'BIN são os 6 a 8 primeiros números do cartão.' } }); hash = binKey(v); label = `BIN ${v}`; break; }
    }
    await this.prisma.blocklist.upsert({ where: { kind_value_hash: { kind: d.kind, value_hash: hash } }, create: { kind: d.kind, value_hash: hash, label, reason: d.reason, created_by: c.userId, expires_at: d.days ? new Date(Date.now() + d.days * 86400000) : null }, update: { reason: d.reason, label, expires_at: d.days ? new Date(Date.now() + d.days * 86400000) : null } });
    await this.audit.log({ actorId: c.userId, action: 'blocklist.add', target: `blocklist:${d.kind}`, after: { label }, reason: d.reason });
    return { ok: true };
  }

  @Delete('blocklist/:id') @Admin('risk.manage')
  async removeBlock(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const { reason } = parse(z.object({ reason: Reason }), b);
    const r = await this.prisma.blocklist.findUnique({ where: { id } });
    if (!r) throw new AppError('NOT_FOUND');
    await this.prisma.blocklist.delete({ where: { id } });
    await this.audit.log({ actorId: c.userId, action: 'blocklist.remove', target: `blocklist:${r.kind}`, before: { label: r.label, reason: r.reason }, reason });
    return { ok: true };
  }
}
