import { Body, Controller, Get, HttpCode, Post, Req, Res, Delete, Param } from '@nestjs/common';
import type { Response } from 'express';
import argon2 from 'argon2';
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infra/prisma.service';
import { NotifyService } from '../../infra/notify.service';
import { AuditService } from '../../infra/audit.service';
import { Public, Producer, Ctx, ProducerCtx, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { randomToken, sha256, encrypt, decrypt, hashIp } from '../../common/crypto';
import { generateSecret, otpauthUrl, verifyTotp } from '../../common/totp';
import * as rl from '../../infra/rate-limit';
import { normalizeBRMobile } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { Inject } from '@nestjs/common';

const SESSION_DAYS = 7; // RN-82
const TERMS_VERSION = '2026-11-01';

/** Checagem contra senhas vazadas por k-anonymity (HIBP) — falha aberta se indisponível. */
async function isPwned(password: string): Promise<boolean> {
  if (process.env.SKIP_PWNED_CHECK === '1') return false;
  const h = createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { signal: ctrl.signal, headers: { 'Add-Padding': 'true' } });
    clearTimeout(t);
    if (!r.ok) return false;
    return (await r.text()).split('\n').some(l => { const [suf, n] = l.trim().split(':'); return suf === h.slice(5) && Number(n) > 0; });
  } catch { return false; }
}

export function cookieOpts(maxAgeMs: number) {
  return { httpOnly: true, secure: (process.env.APP_URL || '').startsWith('https'), sameSite: 'lax' as const, maxAge: maxAgeMs, path: '/' };
}

@Controller('v1/auth')
export class AuthController {
  constructor(private prisma: PrismaService, private notify: NotifyService, private audit: AuditService, @Inject(GATEWAY) private gateway: GatewayAdapter) {}

  private async startSession(res: Response, req: R, userId: string, kind = 'producer') {
    const token = randomToken(32);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const ipHash = hashIp(clientIp(req));
    const known = await this.prisma.sessions.findFirst({ where: { user_id: userId, user_agent: ua } });
    await this.prisma.sessions.create({ data: { user_id: userId, token_hash: sha256(token), kind, user_agent: ua, ip_hash: ipHash, expires_at: new Date(Date.now() + SESSION_DAYS * 86400000) } });
    res.cookie('dm_session', token, cookieOpts(SESSION_DAYS * 86400000));
    return { newDevice: !known, ua };
  }

  @Post('signup') @Public()
  async signup(@Body() b: any, @Req() req: R, @Res({ passthrough: true }) res: Response) {
    const d = parse(z.object({ name: z.string().min(3).max(120), email: z.string().email().max(200), phone: z.string().max(30), password: z.string().max(200), accept_terms: z.literal(true) }), b);
    await rl.limit(`signup:${hashIp(clientIp(req))}`, 10, 3600);
    const phone = normalizeBRMobile(d.phone);
    if (!phone) throw new AppError('VALIDATION_ERROR', { fields: { phone: 'Confira o número com DDD.' } });
    if (d.password.length < 10) throw new AppError('WEAK_PASSWORD', { fields: { password: 'Use uma senha com pelo menos 10 caracteres.' } });
    if (await isPwned(d.password)) throw new AppError('PWNED_PASSWORD', { fields: { password: 'Esta senha já apareceu em vazamentos. Escolha outra.' } });
    const email = d.email.trim().toLowerCase();
    if (await this.prisma.users.findUnique({ where: { email } })) throw new AppError('EMAIL_TAKEN', { fields: { email: 'Já existe uma conta com este e-mail. Tente entrar.' } });
    const password_hash = await argon2.hash(d.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const ipHash = hashIp(clientIp(req));
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.users.create({ data: { email, name: d.name.trim(), phone_enc: encrypt(phone), password_hash } });
      const ws = await tx.workspaces.create({ data: { owner_id: u.id, name: d.name.trim(), support_email: email } });
      await tx.memberships.create({ data: { user_id: u.id, workspace_id: ws.id, role: 'owner', permissions: [] } });
      for (const doc of ['terms', 'privacy', 'prohibited_products']) await tx.legal_acceptances.create({ data: { user_id: u.id, document: doc, version: TERMS_VERSION, ip_hash: ipHash, user_agent: ua } });
      return u;
    });
    await this.sendVerify(user.id, email);
    await this.startSession(res, req, user.id);
    return { ok: true };
  }

  private async sendVerify(userId: string, email: string) {
    const t = randomToken(32);
    await this.prisma.email_tokens.create({ data: { user_id: userId, purpose: 'verify_email', token_hash: sha256(t), expires_at: new Date(Date.now() + 48 * 3600_000) } });
    await this.notify.send({ channel: 'email', to: email, template: 'verify_email', vars: { link: `${process.env.APP_URL}/confirmar-email?token=${t}` }, sensitive: ['link'] });
  }

  @Post('verify-email') @Public() @HttpCode(200)
  async verifyEmail(@Body() b: any) {
    const { token } = parse(z.object({ token: z.string().max(100) }), b);
    const row = await this.prisma.email_tokens.findUnique({ where: { token_hash: sha256(token) } });
    if (!row || row.purpose !== 'verify_email' || row.used_at || row.expires_at < new Date()) throw new AppError('AUTH_LINK_EXPIRED');
    await this.prisma.$transaction([
      this.prisma.email_tokens.update({ where: { id: row.id }, data: { used_at: new Date() } }),
      this.prisma.users.update({ where: { id: row.user_id }, data: { email_verified_at: new Date() } }),
    ]);
    return { ok: true };
  }

  @Post('resend-verification') @Producer() @HttpCode(200)
  async resend(@Ctx() c: ProducerCtx) {
    await rl.limit(`verify:${c.userId}`, 3, 3600);
    await this.sendVerify(c.userId, c.email);
    return { ok: true };
  }

  @Post('login') @Public() @HttpCode(200)
  async login(@Body() b: any, @Req() req: R, @Res({ passthrough: true }) res: Response) {
    const d = parse(z.object({ email: z.string().max(200), password: z.string().max(200) }), b);
    const ipHash = hashIp(clientIp(req));
    await rl.limit(`login:ip:${ipHash}`, 30, 900);
    const u = await this.prisma.users.findUnique({ where: { email: d.email.trim().toLowerCase() } });
    // bloqueio progressivo (11.2)
    if (u?.locked_until && u.locked_until > new Date()) throw new AppError('RATE_LIMITED');
    const ok = u?.password_hash ? await argon2.verify(u.password_hash, d.password) : (await argon2.hash('dummy-timing'), false);
    if (!u || !ok) {
      if (u) {
        const n = u.failed_logins + 1;
        const lockMin = n >= 10 ? 60 : n >= 5 ? 5 * (n - 4) : 0;
        await this.prisma.users.update({ where: { id: u.id }, data: { failed_logins: n, locked_until: lockMin ? new Date(Date.now() + lockMin * 60_000) : null } });
      }
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (u.status !== 'active') throw new AppError('ACCOUNT_BLOCKED');
    await this.prisma.users.update({ where: { id: u.id }, data: { failed_logins: 0, locked_until: null } });
    const s = await this.startSession(res, req, u.id);
    if (s.newDevice && (await this.prisma.sessions.count({ where: { user_id: u.id } })) > 1) {
      await this.notify.send({ channel: 'email', to: u.email, template: 'new_login', vars: { dispositivo: s.ua.slice(0, 80) } });
    }
    return { ok: true, needs_2fa_setup: u.platform_role !== 'none' && !u.totp_enabled_at };
  }

  @Post('logout') @Public() @HttpCode(200)
  async logout(@Req() req: R, @Res({ passthrough: true }) res: Response) {
    const tok = req.cookies?.dm_session;
    if (tok) await this.prisma.sessions.updateMany({ where: { token_hash: sha256(tok) }, data: { revoked_at: new Date() } });
    res.clearCookie('dm_session', { path: '/' });
    return { ok: true };
  }

  @Post('logout-all') @Producer() @HttpCode(200)
  async logoutAll(@Ctx() c: ProducerCtx) {
    await this.prisma.sessions.updateMany({ where: { user_id: c.userId, id: { not: c.sessionId }, revoked_at: null }, data: { revoked_at: new Date() } });
    return { ok: true };
  }

  @Get('sessions') @Producer()
  async sessions(@Ctx() c: ProducerCtx) {
    const rows = await this.prisma.sessions.findMany({ where: { user_id: c.userId, revoked_at: null, expires_at: { gt: new Date() } }, orderBy: { last_seen_at: 'desc' } });
    return rows.map(s => ({ id: s.id, user_agent: s.user_agent, last_seen_at: s.last_seen_at, current: s.id === c.sessionId }));
  }

  @Delete('sessions/:id') @Producer()
  async revoke(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    await this.prisma.sessions.updateMany({ where: { id, user_id: c.userId }, data: { revoked_at: new Date() } });
    return { ok: true };
  }

  @Get('me') @Producer()
  async me(@Ctx() c: ProducerCtx) {
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: c.userId } });
    const ws = c.workspaceId ? await this.prisma.workspaces.findUnique({ where: { id: c.workspaceId } }) : null;
    const memberships = await this.prisma.memberships.findMany({ where: { user_id: c.userId }, include: { workspace: true } });
    return toJSON({
      user: { id: u.id, name: u.name, email: u.email, email_verified: !!u.email_verified_at, totp_enabled: !!u.totp_enabled_at, platform_role: u.platform_role },
      workspace: ws && { id: ws.id, name: ws.name, kyc_status: ws.kyc_status, blocked: !!ws.blocked_at, blocked_reason: ws.blocked_reason, support_whatsapp: ws.support_whatsapp, support_email: ws.support_email },
      workspaces: memberships.map(m => ({ id: m.workspace_id, name: m.workspace.name, role: m.role })),
      role: c.role, permissions: c.permissions, gateway: this.gateway.name,
    });
  }

  @Post('forgot') @Public() @HttpCode(200)
  async forgot(@Body() b: any, @Req() req: R) {
    const { email } = parse(z.object({ email: z.string().max(200) }), b);
    await rl.limit(`forgot:${hashIp(clientIp(req))}`, 5, 900);
    const u = await this.prisma.users.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (u) {
      const t = randomToken(32);
      await this.prisma.email_tokens.create({ data: { user_id: u.id, purpose: 'reset_password', token_hash: sha256(t), expires_at: new Date(Date.now() + 30 * 60_000) } });
      await this.notify.send({ channel: 'email', to: u.email, template: 'reset_password', vars: { link: `${process.env.APP_URL}/nova-senha?token=${t}` }, sensitive: ['link'] });
    }
    return { ok: true }; // mesma resposta sempre
  }

  @Post('reset') @Public() @HttpCode(200)
  async reset(@Body() b: any) {
    const d = parse(z.object({ token: z.string().max(100), password: z.string().max(200) }), b);
    const row = await this.prisma.email_tokens.findUnique({ where: { token_hash: sha256(d.token) } });
    if (!row || row.purpose !== 'reset_password' || row.used_at || row.expires_at < new Date()) throw new AppError('AUTH_LINK_EXPIRED');
    if (d.password.length < 10) throw new AppError('WEAK_PASSWORD');
    if (await isPwned(d.password)) throw new AppError('PWNED_PASSWORD');
    const hash = await argon2.hash(d.password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.email_tokens.update({ where: { id: row.id }, data: { used_at: new Date() } }),
      this.prisma.users.update({ where: { id: row.user_id }, data: { password_hash: hash, failed_logins: 0, locked_until: null } }),
      this.prisma.sessions.updateMany({ where: { user_id: row.user_id, revoked_at: null }, data: { revoked_at: new Date() } }), // encerra as outras sessões
    ]);
    await this.audit.log({ actorId: row.user_id, action: 'user.password_reset', target: `user:${row.user_id}` });
    return { ok: true };
  }

  @Post('2fa/setup') @Producer() @HttpCode(200)
  async setup2fa(@Ctx() c: ProducerCtx) {
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: c.userId } });
    if (u.totp_enabled_at) throw new AppError('VALIDATION_ERROR', { title: 'A verificação em duas etapas já está ativa.' });
    const secret = generateSecret();
    await this.prisma.users.update({ where: { id: c.userId }, data: { totp_secret_enc: encrypt(secret) } });
    const url = otpauthUrl(secret, u.email);
    return { otpauth_url: url, secret, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) };
  }

  @Post('2fa/enable') @Producer() @HttpCode(200)
  async enable2fa(@Ctx() c: ProducerCtx, @Body() b: any, @Req() req: R) {
    const { code } = parse(z.object({ code: z.string().length(6) }), b);
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: c.userId } });
    if (!u.totp_secret_enc || !verifyTotp(decrypt(u.totp_secret_enc), code)) throw new AppError('OTP_INVALID');
    await this.prisma.users.update({ where: { id: c.userId }, data: { totp_enabled_at: new Date() } });
    await this.audit.log({ actorId: c.userId, action: 'user.2fa_enabled', target: `user:${c.userId}`, ipHash: hashIp(clientIp(req)) });
    return { ok: true };
  }

  /** Aceite de convite de sociedade/coprodução. */
  @Post('coproductions/:id/accept') @Producer() @HttpCode(200)
  async acceptCopro(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const cp = await this.prisma.coproductions.findUnique({ where: { id } });
    if (!cp || cp.invited_email.toLowerCase() !== c.email.toLowerCase() || cp.status !== 'invited') throw new AppError('NOT_FOUND');
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: c.workspaceId } });
    if (ws.kyc_status !== 'approved') throw new AppError('KYC_REQUIRED', { title: 'Confirme sua identidade para aceitar a sociedade.' });
    await this.prisma.coproductions.update({ where: { id }, data: { status: 'active', workspace_id: c.workspaceId } });
    await this.audit.log({ actorId: c.userId, action: 'coproduction.accept', target: `coproduction:${id}` });
    return { ok: true };
  }
}
