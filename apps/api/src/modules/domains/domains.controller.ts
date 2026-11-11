import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { Producer, Ctx, ProducerCtx, Public } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { toJSON } from '../../http/json';
import { domainsEnabled, addDomain, checkDomain, removeDomain, dnsRecords } from './vercel-domains';

const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const BLOCKED = /(^|\.)(dommamart\.com(\.br)?|vercel\.app|railway\.app|supabase\.co|localhost)$/;
const MAX_DOMAINS = 3;

/** Domínio próprio do checkout (5.3 / 19.12 g "Domínio próprio"). */
@Controller('v1')
export class DomainsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('settings/domains') @Producer('settings.manage')
  async list(@Ctx() c: ProducerCtx) {
    const rows = await this.prisma.custom_domains.findMany({ where: { workspace_id: c.workspaceId }, orderBy: { created_at: 'asc' } });
    const offer = await this.prisma.offers.findFirst({ where: { workspace_id: c.workspaceId, status: 'active' }, orderBy: { created_at: 'asc' } });
    return toJSON({ enabled: domainsEnabled(), example_slug: offer?.slug ?? null, domains: rows });
  }

  @Post('settings/domains') @Producer('settings.manage')
  async add(@Ctx() c: ProducerCtx, @Body() b: any) {
    if (!domainsEnabled()) throw new AppError('DOMAINS_UNAVAILABLE');
    const { hostname } = parse(z.object({ hostname: z.string().max(253) }), b);
    const host = hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (!HOST_RE.test(host) || BLOCKED.test(host)) throw new AppError('VALIDATION_ERROR', { fields: { hostname: 'Use um domínio seu, por exemplo pay.seusite.com.br.' } });
    if ((await this.prisma.custom_domains.count({ where: { workspace_id: c.workspaceId } })) >= MAX_DOMAINS) throw new AppError('VALIDATION_ERROR', { title: `Limite de ${MAX_DOMAINS} domínios por conta.` });
    const taken = await this.prisma.custom_domains.findUnique({ where: { hostname: host } });
    if (taken) throw new AppError('VALIDATION_ERROR', { fields: { hostname: taken.workspace_id === c.workspaceId ? 'Você já cadastrou este domínio.' : 'Este domínio já está em uso em outra conta.' } });
    let v;
    try { v = await addDomain(host); }
    catch (e) { throw new AppError('VALIDATION_ERROR', { title: `Não conseguimos registrar o domínio: ${(e as Error).message}` }); }
    const row = await this.prisma.custom_domains.create({ data: { workspace_id: c.workspaceId, hostname: host, status: 'pending', dns: dnsRecords(host, v.verification) as any } });
    await this.audit.log({ actorId: c.userId, action: 'domain.add', target: `workspace:${c.workspaceId}`, after: { hostname: host } });
    return toJSON(row);
  }

  @Post('settings/domains/:id/verify') @Producer('settings.manage') @HttpCode(200)
  async verify(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    if (!domainsEnabled()) throw new AppError('DOMAINS_UNAVAILABLE');
    const d = await this.prisma.custom_domains.findFirst({ where: { id, workspace_id: c.workspaceId } });
    if (!d) throw new AppError('NOT_FOUND');
    let r;
    try { r = await checkDomain(d.hostname); }
    catch (e) { return toJSON(await this.prisma.custom_domains.update({ where: { id }, data: { last_error: String((e as Error).message).slice(0, 300) } })); }
    const active = r.verified && !r.misconfigured;
    const row = await this.prisma.custom_domains.update({ where: { id }, data: {
      status: active ? 'active' : 'pending', verified_at: active ? (d.verified_at ?? new Date()) : null,
      last_error: active ? null : 'O DNS ainda não aponta para nós. A propagação pode levar algumas horas.',
      ...(r.verification.length ? { dns: dnsRecords(d.hostname, r.verification) as any } : {}),
    } });
    return toJSON(row);
  }

  @Delete('settings/domains/:id') @Producer('settings.manage')
  async remove(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const d = await this.prisma.custom_domains.findFirst({ where: { id, workspace_id: c.workspaceId } });
    if (!d) throw new AppError('NOT_FOUND');
    if (domainsEnabled()) await removeDomain(d.hostname).catch(() => {});
    await this.prisma.custom_domains.delete({ where: { id } });
    await this.audit.log({ actorId: c.userId, action: 'domain.remove', target: `workspace:${c.workspaceId}`, before: { hostname: d.hostname } });
    return { ok: true };
  }

  /** Consulta do middleware do site: qual conta atende este domínio (só domínios ativos). */
  @Get('public/domains/:host') @Public()
  async resolve(@Param('host') host: string) {
    const d = await this.prisma.custom_domains.findUnique({ where: { hostname: host.toLowerCase() } });
    if (!d || d.status !== 'active') throw new AppError('NOT_FOUND');
    return { hostname: d.hostname, workspace_id: d.workspace_id };
  }
}
