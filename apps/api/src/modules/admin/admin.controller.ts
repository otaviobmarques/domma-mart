import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { AuditService } from '../../infra/audit.service';
import { NotifyService } from '../../infra/notify.service';
import { OrdersService } from '../orders/orders.service';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { Admin, Ctx, ProducerCtx, Public, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { decrypt, blindIndex, hashIp } from '../../common/crypto';
import { maskDocument, maskEmail } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { statusLabel, OrderStatus } from '../../domain/order-state';
import { SandboxGateway } from '../gateway/sandbox.adapter';

const Reason = z.string().min(10, 'Explique o motivo (mín. 10 caracteres).').max(1000);

@Controller('v1/admin')
export class AdminController {
  constructor(private prisma: PrismaService, private storage: StorageService, private audit: AuditService, private notify: NotifyService, private orders: OrdersService, @Inject(GATEWAY) private gateway: GatewayAdapter) {}

  @Get('overview') @Admin('admin.view')
  async overview() {
    const [kyc, moderation, disputes, accounts] = await Promise.all([
      this.prisma.kyc_submissions.count({ where: { status: 'in_review' } }),
      this.prisma.products.count({ where: { moderation_status: 'in_review', deleted_at: null } }),
      this.prisma.orders.count({ where: { status: 'chargeback' } }),
      this.prisma.workspaces.count(),
    ]);
    const [rev] = await this.prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(SUM(credit_cents-debit_cents),0)::bigint s FROM ledger_entries WHERE owner_type='platform'`;
    const [gmv] = await this.prisma.$queryRaw<{ s: bigint; n: bigint }[]>`SELECT COALESCE(SUM(total_cents),0)::bigint s, COUNT(*)::bigint n FROM orders WHERE paid_at IS NOT NULL AND paid_at > now() - interval '30 days'`;
    const adjustments = await this.prisma.ledger_adjustments.count({ where: { status: 'pending' } });
    const failedHooks = await this.prisma.webhook_events_in.count({ where: { processed_at: null, created_at: { lt: new Date(Date.now() - 5 * 60_000) } } });
    return toJSON({ pending: { kyc, moderation, disputes, failed_webhooks: failedHooks, adjustments }, accounts, platform_revenue_cents: rev.s, gmv_30d_cents: gmv.s, orders_30d: gmv.n });
  }

  // ───── Fila de KYC (19.11) ─────
  @Get('kyc') @Admin('kyc.view')
  async kycQueue(@Query('status') status = 'in_review', @Query('risk') risk?: string) {
    const rows = await this.prisma.kyc_submissions.findMany({ where: { status: status as any, ...(risk ? { risk } : {}) }, orderBy: { created_at: 'asc' }, take: 200 }); // mais antigos primeiro
    const ws = await this.prisma.workspaces.findMany({ where: { id: { in: rows.map(r => r.workspace_id) } } });
    return toJSON(rows.map(r => ({ id: r.id, workspace_id: r.workspace_id, account: ws.find(w => w.id === r.workspace_id)?.name, name: r.name, person_type: r.person_type, created_at: r.created_at, risk: r.risk, checks: r.auto_checks, status: r.status })));
  }

  @Get('kyc/:id') @Admin('kyc.view')
  async kycDetail(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const r = await this.prisma.kyc_submissions.findUnique({ where: { id } });
    if (!r) throw new AppError('NOT_FOUND');
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: r.workspace_id } });
    const sign = (k: string | null) => (k ? this.storage.signedUrl(k, 5 * 60, { nocache: true }) : null); // URLs de 5 min, sem cache
    await this.audit.log({ actorId: c.userId, action: 'kyc.view', target: `kyc:${id}` });
    return toJSON({
      id: r.id, name: r.name, person_type: r.person_type, document: maskDocument(decrypt(r.document_enc)), birth_date: r.birth_date, partner_name: r.partner_name,
      account_created_at: ws.created_at, risk: r.risk, checks: r.auto_checks, status: r.status, decision_reason: r.decision_reason,
      images: { front: sign(r.doc_front_key), back: sign(r.doc_back_key), selfie: sign(r.selfie_key) }, watermark: c.name,
      can_decide: c.permissions.includes('kyc.decide'),
    });
  }

  @Post('kyc/:id/decision') @Admin('kyc.decide') @HttpCode(200)
  async decide(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any, @Req() req: R) {
    const d = parse(z.object({ decision: z.enum(['approve', 'request_docs', 'reject']), reason: Reason, category: z.enum(['document_illegible', 'document_mismatch', 'fraud_suspected', 'underage', 'prohibited_activity', 'other']).optional() }), b);
    if (d.decision === 'reject' && !d.category) throw new AppError('VALIDATION_ERROR', { fields: { category: 'Escolha a categoria do motivo.' } });
    const r = await this.prisma.kyc_submissions.findUnique({ where: { id } });
    if (!r || r.status !== 'in_review') throw new AppError('NOT_FOUND');
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: r.workspace_id } });
    const owner = await this.prisma.users.findUniqueOrThrow({ where: { id: ws.owner_id } });
    let subaccount = ws.gateway_subaccount_id;
    if (d.decision === 'approve' && !subaccount) subaccount = (await this.gateway.createSubaccount({ workspaceId: ws.id, name: r.name, document: decrypt(r.document_enc) })).id;
    const newStatus = d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? 'rejected' : 'pending';
    await this.prisma.$transaction(async (tx) => {
      await tx.kyc_submissions.update({ where: { id }, data: { status: d.decision === 'request_docs' ? 'rejected' : (newStatus as any), decided_by: c.userId, decision_reason: d.reason, decided_at: new Date() } });
      await tx.workspaces.update({ where: { id: ws.id }, data: { kyc_status: newStatus as any, gateway_subaccount_id: subaccount } });
      await this.audit.log({ actorId: c.userId, action: `kyc.${d.decision}`, target: `workspace:${ws.id}`, before: { kyc_status: ws.kyc_status }, after: { kyc_status: newStatus, category: d.category }, reason: d.reason, ipHash: hashIp(clientIp(req)) }, tx);
    });
    const link = `${process.env.APP_URL}/identidade`;
    if (d.decision === 'approve') await this.notify.send({ channel: 'email', to: owner.email, template: 'kyc_approved', workspaceId: ws.id, vars: {} });
    else await this.notify.send({ channel: 'email', to: owner.email, template: d.decision === 'reject' ? 'kyc_rejected' : 'kyc_more_docs', workspaceId: ws.id, vars: { motivo: d.reason, link } });
    return { ok: true, status: newStatus };
  }

  // ───── Moderação de produtos (RN-65) ─────
  @Get('moderation') @Admin('moderation.decide')
  async moderation() {
    const ps = await this.prisma.products.findMany({ where: { moderation_status: 'in_review', deleted_at: null }, include: { workspace: true, offers: { take: 1 } }, orderBy: { updated_at: 'asc' } });
    return toJSON(ps.map(p => ({ id: p.id, name: p.name, description: p.description, type: p.type, notes: p.moderation_notes, account: p.workspace.name, price_cents: p.offers[0]?.price_cents, updated_at: p.updated_at })));
  }

  @Post('moderation/:id/decision') @Admin('moderation.decide') @HttpCode(200)
  async moderate(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const d = parse(z.object({ decision: z.enum(['approve', 'reject']), reason: Reason }), b);
    const p = await this.prisma.products.findUniqueOrThrow({ where: { id } });
    await this.prisma.products.update({ where: { id }, data: { moderation_status: d.decision === 'approve' ? 'approved' : 'rejected', moderation_notes: d.reason, published_at: d.decision === 'approve' ? (p.published_at ?? new Date()) : p.published_at } });
    if (d.decision === 'approve') await this.prisma.offers.updateMany({ where: { product_id: id, status: 'draft' }, data: { status: 'active' } });
    await this.audit.log({ actorId: c.userId, action: `moderation.${d.decision}`, target: `product:${id}`, before: { status: p.moderation_status }, reason: d.reason });
    return { ok: true };
  }

  // ───── Contas, taxas e limites ─────
  @Get('accounts') @Admin('admin.view')
  async accounts(@Query('q') q?: string) {
    const users = q ? await this.prisma.users.findMany({ where: { OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: 'insensitive' } }] }, take: 50 }) : [];
    const ws = await this.prisma.workspaces.findMany({ where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { owner_id: { in: users.map(u => u.id) } }] } : {}, orderBy: { created_at: 'desc' }, take: 100 });
    const owners = await this.prisma.users.findMany({ where: { id: { in: ws.map(w => w.owner_id) } } });
    return toJSON(ws.map(w => ({ id: w.id, name: w.name, owner_email: maskEmail(owners.find(u => u.id === w.owner_id)?.email ?? 'x@x'), kyc_status: w.kyc_status, blocked: !!w.blocked_at, blocked_reason: w.blocked_reason, custom_fee_bps: w.custom_fee_bps, daily_withdraw_limit: w.daily_withdraw_limit, created_at: w.created_at })));
  }

  @Post('accounts/:id/block') @Admin('risk.manage') @HttpCode(200)
  async block(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const { reason, blocked } = parse(z.object({ reason: Reason, blocked: z.boolean() }), b);
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id } });
    await this.prisma.workspaces.update({ where: { id }, data: { blocked_at: blocked ? new Date() : null, blocked_reason: blocked ? reason : null } });
    await this.audit.log({ actorId: c.userId, action: blocked ? 'account.block' : 'account.unblock', target: `workspace:${id}`, before: { blocked: !!ws.blocked_at }, after: { blocked }, reason });
    return { ok: true };
  }

  @Patch('accounts/:id/limits') @Admin('fees.manage')
  async limits(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const d = parse(z.object({ custom_fee_bps: z.number().int().min(0).max(2000).nullable().optional(), daily_withdraw_limit: z.number().int().min(1000).optional(), reserve_pct: z.number().int().min(0).max(50).optional(), reason: Reason }), b);
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id } });
    const { reason, ...data } = d;
    const upd = await this.prisma.workspaces.update({ where: { id }, data: { ...data, daily_withdraw_limit: data.daily_withdraw_limit != null ? BigInt(data.daily_withdraw_limit) : undefined } });
    await this.audit.log({ actorId: c.userId, action: 'account.limits', target: `workspace:${id}`, before: { fee: ws.custom_fee_bps, limit: ws.daily_withdraw_limit, reserve: ws.reserve_pct }, after: { fee: upd.custom_fee_bps, limit: upd.daily_withdraw_limit, reserve: upd.reserve_pct }, reason });
    return { ok: true };
  }

  // ───── Pedidos e disputas ─────
  @Get('orders') @Admin('orders.lookup')
  async lookup(@Ctx() c: ProducerCtx, @Query('q') q: string) {
    if (!q) return [];
    const custs = await this.prisma.customers.findMany({ where: { OR: [{ email: q.toLowerCase() }, { document_hash: blindIndex(q.replace(/\D/g, '')) }] }, take: 20 });
    const rows = await this.prisma.orders.findMany({ where: { OR: [{ code: q.toUpperCase() }, { customer_id: { in: custs.map(x => x.id) } }] }, include: { events: { orderBy: { created_at: 'asc' } } }, orderBy: { created_at: 'desc' }, take: 50 });
    await this.audit.log({ actorId: c.userId, action: 'orders.lookup', target: `query:${q.slice(0, 3)}***` });
    const all = await this.prisma.customers.findMany({ where: { id: { in: rows.map(r => r.customer_id) } } });
    return toJSON(rows.map(o => ({ id: o.id, code: o.code, status: o.status, status_label: statusLabel(o.status as OrderStatus), method: o.method, total_cents: o.total_cents, created_at: o.created_at, customer: maskEmail(all.find(x => x.id === o.customer_id)!.email), timeline: o.events.map(e => ({ at: e.created_at, event: e.event, to: e.to_status })) })));
  }

  @Get('disputes') @Admin('disputes.manage')
  async disputes() {
    const rows = await this.prisma.orders.findMany({ where: { status: { in: ['chargeback', 'chargeback_won', 'chargeback_lost'] } }, orderBy: { updated_at: 'desc' }, take: 100 });
    return toJSON(rows.map(o => ({ id: o.id, code: o.code, status: o.status, total_cents: o.total_cents, updated_at: o.updated_at, workspace_id: o.workspace_id })));
  }

  /** Evidências automáticas para contestação (RN-54): acesso às aulas, IP, aceite. */
  @Get('orders/:id/evidence') @Admin('disputes.manage')
  async evidence(@Param('id') id: string) {
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id }, include: { items: true, events: true } });
    const progress = await this.prisma.lesson_progress.findMany({ where: { customer_id: o.customer_id, product_id: { in: o.items.map(i => i.product_id) } }, orderBy: { updated_at: 'asc' } });
    return toJSON({ order: { code: o.code, created_at: o.created_at, paid_at: o.paid_at, ip_hash: o.ip_hash, user_agent: o.user_agent, total_cents: o.total_cents }, events: o.events, lesson_access: progress.map(p => ({ lesson_id: p.lesson_id, first_at: p.created_at, last_at: p.updated_at, position_sec: p.position_sec, completed_at: p.completed_at })) });
  }

  /** Registra contestação vinda do gateway (ou simula no sandbox). */
  @Post('orders/:id/chargeback') @Admin('disputes.manage') @HttpCode(200)
  async chargeback(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const d = parse(z.object({ stage: z.enum(['opened', 'won', 'lost']), reason: Reason }), b);
    if (this.gateway instanceof SandboxGateway) {
      const pay = await this.prisma.payments.findFirstOrThrow({ where: { order_id: id, status: 'paid' } });
      await this.gateway.emit({ type: d.stage === 'opened' ? 'charge.chargeback' : d.stage === 'won' ? 'charge.chargeback_won' : 'charge.chargeback_lost', chargeId: pay.provider_charge_id });
    } else {
      await this.orders.chargeback(id, d.stage);
    }
    await this.audit.log({ actorId: c.userId, action: `chargeback.${d.stage}`, target: `order:${id}`, reason: d.reason });
    return { ok: true };
  }

  @Post('orders/:id/refund') @Admin('disputes.manage') @HttpCode(202)
  async refund(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const { reason } = parse(z.object({ reason: Reason }), b);
    return toJSON(await this.orders.refund(id, 'platform', { actorId: c.userId, reason }));
  }

  // ───── Risco (RN-55) ─────
  @Get('risk') @Admin('risk.manage')
  async risk() {
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT o.workspace_id, w.name, COUNT(*) FILTER (WHERE o.paid_at IS NOT NULL)::int paid,
        COUNT(*) FILTER (WHERE o.status IN ('chargeback','chargeback_lost','chargeback_won'))::int cb,
        COUNT(*) FILTER (WHERE o.status='refunded')::int refunds
      FROM orders o JOIN workspaces w ON w.id=o.workspace_id WHERE o.created_at > now() - interval '30 days' GROUP BY 1,2`);
    return rows.map(r => {
      const rate = r.paid ? (r.cb / r.paid) * 100 : 0;
      return { ...r, chargeback_pct: Math.round(rate * 100) / 100, refund_pct: r.paid ? Math.round((r.refunds / r.paid) * 10000) / 100 : 0, level: rate >= 2 ? 'bloqueio cautelar' : rate >= 1.5 ? 'revisão' : rate >= 1 ? 'alerta' : 'ok' };
    }).sort((a, b) => b.chargeback_pct - a.chargeback_pct);
  }

  @Post('blocklist') @Admin('risk.manage')
  async addBlock(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ kind: z.enum(['cpf', 'email', 'email_domain', 'ip']), value: z.string().min(3).max(200), reason: Reason, days: z.number().int().min(1).max(3650).optional() }), b);
    const value = d.kind === 'cpf' ? d.value.replace(/\D/g, '') : d.kind === 'ip' ? `ip:${d.value}` : d.value.toLowerCase();
    await this.prisma.blocklist.upsert({ where: { kind_value_hash: { kind: d.kind, value_hash: blindIndex(value) } }, create: { kind: d.kind, value_hash: blindIndex(value), reason: d.reason, created_by: c.userId, expires_at: d.days ? new Date(Date.now() + d.days * 86400000) : null }, update: { reason: d.reason } });
    await this.audit.log({ actorId: c.userId, action: 'blocklist.add', target: `blocklist:${d.kind}`, reason: d.reason });
    return { ok: true };
  }

  // ───── Auditoria e conciliação ─────
  @Get('audit') @Admin('audit.view')
  async auditLog(@Query('target') target?: string) {
    const rows = await this.prisma.audit_logs.findMany({ where: target ? { target: { contains: target } } : {}, orderBy: { seq: 'desc' }, take: 200 });
    const users = await this.prisma.users.findMany({ where: { id: { in: rows.map(r => r.actor_id).filter(Boolean) as string[] } } });
    return toJSON({ chain: await this.audit.verifyChain(), rows: rows.map(r => ({ ...r, actor: users.find(u => u.id === r.actor_id)?.name ?? 'sistema' })) });
  }

  @Get('reconciliation') @Admin('reconciliation.view')
  async reconciliation() {
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'America/Sao_Paulo'),'YYYY-MM-DD') d, owner_type,
        SUM(debit_cents)::bigint debits, SUM(credit_cents)::bigint credits FROM ledger_entries
      WHERE created_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 1 DESC, 2`);
    const [bal] = await this.prisma.$queryRaw<{ d: bigint; c: bigint }[]>`SELECT SUM(debit_cents)::bigint d, SUM(credit_cents)::bigint c FROM ledger_entries`;
    return toJSON({ balanced: bal.d === bal.c, total_debits: bal.d ?? 0, total_credits: bal.c ?? 0, by_day: rows });
  }
}

/** Caixa de saída de desenvolvimento: ver links mágicos/códigos sem e-mail real. */
@Controller('v1/dev')
@Public()
export class DevController {
  constructor(private prisma: PrismaService) {}
  @Get('outbox')
  async outbox(@Query('to') to?: string) {
    if (process.env.NODE_ENV === 'production') throw new AppError('NOT_FOUND');
    const rows = await this.prisma.notifications.findMany({ where: { status: 'logged', ...(to ? { to_masked: { startsWith: to.slice(0, 1) } } : {}) }, orderBy: { created_at: 'desc' }, take: 50 });
    return rows.map(r => ({ at: r.created_at, channel: r.channel, to: r.to_masked, template: r.template, subject: r.subject, body: r.body }));
  }
}
