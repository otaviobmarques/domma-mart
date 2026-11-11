import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { NotifyService } from '../../infra/notify.service';
import { Producer, Ctx, ProducerCtx, ALL_PERMISSIONS } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { encrypt, decrypt, randomToken } from '../../common/crypto';
import { normalizeBRMobile } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { isPublicHttpUrl } from '../integrations/ssrf';
import { JobsService } from '../jobs/jobs.service';

const EVENTS = ['order.created', 'order.paid', 'order.refunded', 'order.chargeback', 'pix.generated', 'boleto.generated', 'cart.abandoned', 'subscription.renewed', 'subscription.canceled', 'affiliate.commission'];

/** Configurações (19.12 g): dados da conta, equipe, integrações, recuperação. */
@Controller('v1/settings')
export class SettingsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotifyService, private jobs: JobsService) {}

  @Patch('workspace') @Producer('settings.manage')
  async workspace(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ name: z.string().min(2).max(120).optional(), support_whatsapp: z.string().max(30).nullable().optional(), support_email: z.string().email().nullable().optional() }), b);
    const data: any = { ...d };
    if (d.support_whatsapp) { const p = normalizeBRMobile(d.support_whatsapp); if (!p) throw new AppError('VALIDATION_ERROR', { fields: { support_whatsapp: 'Confira o número com DDD.' } }); data.support_whatsapp = p; }
    const ws = await this.prisma.workspaces.update({ where: { id: c.workspaceId }, data });
    return toJSON({ name: ws.name, support_whatsapp: ws.support_whatsapp, support_email: ws.support_email });
  }

  // ───── Equipe (RBAC granular) ─────
  @Get('team') @Producer('team.manage')
  async team(@Ctx() c: ProducerCtx) {
    const ms = await this.prisma.memberships.findMany({ where: { workspace_id: c.workspaceId }, include: { user: true } });
    return { permissions: ALL_PERMISSIONS, members: ms.map(m => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role, permissions: m.role === 'owner' ? ALL_PERMISSIONS : m.permissions })) };
  }

  @Post('team') @Producer('team.manage')
  async invite(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ email: z.string().email(), permissions: z.array(z.enum(ALL_PERMISSIONS)).min(1) }), b);
    if (!c.totpEnabled) throw new AppError('TWO_FACTOR_REQUIRED'); // 11.2: 2FA obrigatório para gerir equipe
    const u = await this.prisma.users.findUnique({ where: { email: d.email.toLowerCase() } });
    if (!u) throw new AppError('VALIDATION_ERROR', { fields: { email: 'Peça para essa pessoa criar uma conta Domma Mart primeiro.' } });
    // e-mail confirmado: quem cadastrou o e-mail de outra pessoa antes dela não ganha acesso à equipe
    if (!u.email_verified_at) throw new AppError('VALIDATION_ERROR', { fields: { email: 'Essa pessoa ainda não confirmou o e-mail da conta. Peça para ela clicar no link que enviamos.' } });
    const m = await this.prisma.memberships.upsert({ where: { user_id_workspace_id: { user_id: u.id, workspace_id: c.workspaceId } }, create: { user_id: u.id, workspace_id: c.workspaceId, role: 'collaborator', permissions: d.permissions }, update: { permissions: d.permissions } });
    await this.audit.log({ actorId: c.userId, action: 'team.set', target: `workspace:${c.workspaceId}`, after: { user: u.id, permissions: d.permissions } });
    return toJSON(m);
  }

  @Delete('team/:id') @Producer('team.manage')
  async removeMember(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const m = await this.prisma.memberships.findFirst({ where: { id, workspace_id: c.workspaceId } });
    if (!m || m.role === 'owner') throw new AppError('NOT_FOUND');
    await this.prisma.memberships.delete({ where: { id } });
    await this.audit.log({ actorId: c.userId, action: 'team.remove', target: `workspace:${c.workspaceId}`, before: { user: m.user_id } });
    return { ok: true };
  }

  // ───── Webhooks do produtor (5.8 / 22.7) ─────
  @Get('webhooks') @Producer('settings.manage')
  async webhooks(@Ctx() c: ProducerCtx) {
    const eps = await this.prisma.webhook_endpoints.findMany({ where: { workspace_id: c.workspaceId }, orderBy: { created_at: 'desc' } });
    const deliveries = await this.prisma.webhook_deliveries.findMany({ where: { endpoint_id: { in: eps.map(e => e.id) } }, orderBy: { created_at: 'desc' }, take: 30 });
    return toJSON({ events: EVENTS, endpoints: eps.map(e => ({ id: e.id, url: e.url, events: e.events, active: e.active, disabled_at: e.disabled_at })), deliveries: deliveries.map(d => ({ id: d.id, endpoint_id: d.endpoint_id, event_type: d.event_type, attempts: d.attempts, last_status: d.last_status, last_error: d.last_error, delivered_at: d.delivered_at, created_at: d.created_at })) });
  }

  @Post('webhooks') @Producer('settings.manage')
  async addWebhook(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ url: z.string().url().max(500), events: z.array(z.enum(EVENTS as [string, ...string[]])).min(1) }), b);
    if (!(await isPublicHttpUrl(d.url))) throw new AppError('VALIDATION_ERROR', { fields: { url: 'Use um endereço https público.' } });
    const secret = `whsec_${randomToken(24)}`;
    const ep = await this.prisma.webhook_endpoints.create({ data: { workspace_id: c.workspaceId, url: d.url, events: d.events, secret_enc: encrypt(secret) } });
    await this.audit.log({ actorId: c.userId, action: 'webhook.create', target: `workspace:${c.workspaceId}`, after: { url: d.url } });
    return { id: ep.id, secret, message: 'Guarde este segredo: ele não será mostrado de novo.' };
  }

  @Post('webhooks/:id/test') @Producer('settings.manage') @HttpCode(200)
  async testWebhook(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const ep = await this.prisma.webhook_endpoints.findFirst({ where: { id, workspace_id: c.workspaceId } });
    if (!ep) throw new AppError('NOT_FOUND');
    const payload = { id: `evt_test_${randomToken(8)}`, type: 'order.paid', created_at: new Date().toISOString(), data: { order_id: 'ord_teste', amount: 19700, method: 'pix', customer: { name: 'Maria S.', email: 'm***@gmail.com' } }, test: true };
    const d = await this.prisma.webhook_deliveries.create({ data: { endpoint_id: ep.id, event_id: payload.id, event_type: 'order.paid', payload } });
    await this.jobs.deliverWebhook(d.id);
    return toJSON(await this.prisma.webhook_deliveries.findUnique({ where: { id: d.id } }));
  }

  @Delete('webhooks/:id') @Producer('settings.manage')
  async delWebhook(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    await this.prisma.webhook_endpoints.updateMany({ where: { id, workspace_id: c.workspaceId }, data: { active: false, disabled_at: new Date() } });
    return { ok: true };
  }

  // ───── Recuperação de vendas (19.12 f) ─────
  @Get('recovery') @Producer('settings.manage')
  async recovery(@Ctx() c: ProducerCtx) {
    const s = await this.prisma.recovery_settings.findUnique({ where: { workspace_id: c.workspaceId } });
    const recovered = await this.prisma.$queryRaw<{ n: bigint; cents: bigint }[]>`
      SELECT COUNT(DISTINCT o.id)::bigint n, COALESCE(SUM(DISTINCT o.total_cents),0)::bigint cents FROM orders o
      WHERE o.workspace_id=${c.workspaceId}::uuid AND o.paid_at IS NOT NULL AND EXISTS (SELECT 1 FROM notifications n WHERE n.ref_id=o.id::text AND n.template IN ('recovery','pix_unpaid') AND n.created_at < o.paid_at)`;
    return toJSON({ settings: s ?? { pix_unpaid: true, boleto_unpaid: true, card_declined: true, abandoned: true, email: true, whatsapp: true, delays_min: [15, 120, 1440], template: '{nome}, seu pedido de {produto} ainda está esperando. Termine aqui: {link}' }, recovered: recovered[0] });
  }

  @Put('recovery') @Producer('settings.manage')
  async setRecovery(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ pix_unpaid: z.boolean(), boleto_unpaid: z.boolean(), card_declined: z.boolean(), abandoned: z.boolean(), email: z.boolean(), whatsapp: z.boolean(), delays_min: z.array(z.number().int().min(5).max(10080)).min(1).max(3), template: z.string().min(10).max(500) }), b);
    return toJSON(await this.prisma.recovery_settings.upsert({ where: { workspace_id: c.workspaceId }, create: { workspace_id: c.workspaceId, ...d }, update: d }));
  }

  @Get('notifications') @Producer('settings.manage')
  async notifications(@Ctx() c: ProducerCtx) {
    return toJSON(await this.prisma.notifications.findMany({ where: { workspace_id: c.workspaceId }, orderBy: { created_at: 'desc' }, take: 50, select: { id: true, channel: true, to_masked: true, template: true, status: true, created_at: true } }));
  }
}
