import { Controller, Get, Query, Req, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { NotifyService } from '../../infra/notify.service';
import { Public, Req as R, clientIp } from '../../http/context';
import { randomToken, sha256, signToken, verifyToken, hashIp } from '../../common/crypto';
import { cookieOpts } from './auth.controller';
import * as rl from '../../infra/rate-limit';

const SESSION_DAYS = 7;
const TERMS_VERSION = '2026-11-11'; // mesma versão de apps/web/lib/legal.ts

/** Endpoints configuráveis só para teste (servidor falso local); em produção usam os do Google. */
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const USERINFO_URL = () => process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function safeBack(v?: string) { return v && v.startsWith('/') && !v.startsWith('//') ? v.slice(0, 300) : '/inicio'; }

/**
 * "Continuar com Google" (5.1): OAuth 2.0 authorization code + PKCE, no servidor.
 * Só aceita e-mail verificado pelo Google. Conta nova precisa ter aceitado os termos na tela de cadastro.
 */
@Controller('v1/auth')
@Public()
export class GoogleAuthController {
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotifyService) {}

  @Get('providers')
  providers() { return { google: googleEnabled() }; }

  @Get('google/start')
  async start(@Query('volta') volta: string, @Query('aceite') aceite: string, @Req() req: R, @Res() res: Response) {
    const app = process.env.APP_URL || 'http://localhost:3000';
    if (!googleEnabled()) return res.redirect(302, `${app}/entrar?erro=google_indisponivel`);
    await rl.limit(`google:${hashIp(clientIp(req))}`, 20, 600);
    const verifier = randomToken(48);
    const state = randomToken(24);
    // estado assinado em cookie curto: amarra o retorno a este navegador (anti-CSRF do OAuth)
    res.cookie('dm_oauth', signToken({ s: state, v: verifier, b: safeBack(volta), t: aceite === '1', exp: Date.now() + 10 * 60_000 }), { ...cookieOpts(10 * 60_000), path: '/v1/auth/google' });
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: `${app}/v1/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    });
    return res.redirect(302, `${AUTH_URL()}?${q}`);
  }

  @Get('google/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Req() req: R, @Res() res: Response) {
    const app = process.env.APP_URL || 'http://localhost:3000';
    const fail = (motivo: string) => { res.clearCookie('dm_oauth', { path: '/v1/auth/google' }); return res.redirect(302, `${app}/entrar?erro=${motivo}`); };
    const st = verifyToken<{ s: string; v: string; b: string; t: boolean }>(req.cookies?.dm_oauth);
    if (error) return fail('google_cancelado');
    if (!st || !state || st.s !== state || !code) return fail('google_expirado');
    try {
      const tr = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${app}/v1/auth/google/callback`, grant_type: 'authorization_code', code_verifier: st.v,
      }) });
      if (!tr.ok) return fail('google_falhou');
      const tok = (await tr.json()) as { access_token?: string };
      const ur = await fetch(USERINFO_URL(), { headers: { authorization: `Bearer ${tok.access_token}` } });
      if (!ur.ok) return fail('google_falhou');
      const info = (await ur.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
      if (!info.sub || !info.email || info.email_verified !== true) return fail('google_email_nao_verificado');
      const email = info.email.trim().toLowerCase();

      let user = await this.prisma.users.findUnique({ where: { google_sub: info.sub } });
      if (!user) {
        const byEmail = await this.prisma.users.findUnique({ where: { email } });
        if (byEmail) {
          // e-mail verificado pelo Google = dono do e-mail. Se a conta existente nunca confirmou o
          // e-mail, quem a criou pode não ser o dono (sequestro prévio): a senha antiga e as sessões caem.
          const unverified = !byEmail.email_verified_at;
          user = await this.prisma.$transaction(async (tx) => {
            if (unverified) await tx.sessions.updateMany({ where: { user_id: byEmail.id, revoked_at: null }, data: { revoked_at: new Date() } });
            return tx.users.update({ where: { id: byEmail.id }, data: { google_sub: info.sub, email_verified_at: byEmail.email_verified_at ?? new Date(), ...(unverified ? { password_hash: null, totp_secret_enc: null, totp_enabled_at: null } : {}) } });
          });
          await this.audit.log({ actorId: user.id, action: 'user.google_linked', target: `user:${user.id}`, after: { reset_unverified_credentials: unverified }, ipHash: hashIp(clientIp(req)) });
        } else {
          if (!st.t) { res.clearCookie('dm_oauth', { path: '/v1/auth/google' }); return res.redirect(302, `${app}/criar-conta?google=1&email=${encodeURIComponent(email)}`); }
          const name = (info.name || email.split('@')[0]).slice(0, 120);
          const ipHash = hashIp(clientIp(req));
          const ua = String(req.headers['user-agent'] || '').slice(0, 300);
          user = await this.prisma.$transaction(async (tx) => {
            const u = await tx.users.create({ data: { email, name, google_sub: info.sub, email_verified_at: new Date() } });
            const ws = await tx.workspaces.create({ data: { owner_id: u.id, name, support_email: email } });
            await tx.memberships.create({ data: { user_id: u.id, workspace_id: ws.id, role: 'owner', permissions: [] } });
            for (const doc of ['terms', 'privacy', 'prohibited_products']) await tx.legal_acceptances.create({ data: { user_id: u.id, document: doc, version: TERMS_VERSION, ip_hash: ipHash, user_agent: ua } });
            return u;
          });
        }
      }
      if (user.status !== 'active') return fail('conta_bloqueada');
      const token = randomToken(32);
      const ua = String(req.headers['user-agent'] || '').slice(0, 300);
      const known = await this.prisma.sessions.findFirst({ where: { user_id: user.id, user_agent: ua } });
      await this.prisma.sessions.create({ data: { user_id: user.id, token_hash: sha256(token), user_agent: ua, ip_hash: hashIp(clientIp(req)), expires_at: new Date(Date.now() + SESSION_DAYS * 86400000) } });
      if (!known && (await this.prisma.sessions.count({ where: { user_id: user.id } })) > 1) {
        await this.notify.send({ channel: 'email', to: user.email, template: 'new_login', vars: { dispositivo: ua.slice(0, 80) } });
      }
      res.clearCookie('dm_oauth', { path: '/v1/auth/google' });
      res.cookie('dm_session', token, cookieOpts(SESSION_DAYS * 86400000));
      return res.redirect(302, `${app}${st.b}`);
    } catch {
      return fail('google_falhou');
    }
  }
}
