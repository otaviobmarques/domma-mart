import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../infra/prisma.service';
import { AUTH_KEY, AuthSpec, Req, ALL_PERMISSIONS, PLATFORM_PERMS } from './context';
import { sha256, safeEqual, hashIp } from '../common/crypto';
import { parseApiKey } from '../domain/api-keys';
import * as rl from '../infra/rate-limit';
import { trustedClientIp } from './edge';
import { AppError } from '../common/errors';

const INACTIVITY_MS = 2 * 60 * 60 * 1000; // RN-82: 2 h de inatividade em telas financeiras

/**
 * RBAC validado no back-end em toda requisição (seção 2 e 11.3).
 * CSRF: cookies SameSite=Lax + cabeçalho obrigatório X-Requested-With em métodos que mudam estado.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  /**
   * API pública: chave no cabeçalho Authorization (sem cookie, então sem risco de CSRF).
   * Chave revogada, de conta bloqueada ou sem a permissão da rota é recusada; limite de 120 chamadas/min por chave.
   */
  private async apiKey(req: Req, scope?: string): Promise<boolean> {
    const auth = String(req.headers.authorization || '');
    const parsed = parseApiKey(auth.startsWith('Bearer ') ? auth.slice(7) : undefined);
    if (!parsed) throw new AppError('UNAUTHENTICATED', { title: 'Envie a chave da API no cabeçalho Authorization: Bearer dm_live_...' });
    const k = await this.prisma.api_keys.findUnique({ where: { prefix: parsed.prefix } });
    if (!k || k.revoked_at || !safeEqual(k.key_hash, sha256(parsed.key))) throw new AppError('UNAUTHENTICATED', { title: 'Chave da API inválida ou revogada.' });
    const ws = await this.prisma.workspaces.findUnique({ where: { id: k.workspace_id }, select: { blocked_at: true } });
    if (!ws || ws.blocked_at) throw new AppError('ACCOUNT_BLOCKED');
    if (scope && !k.scopes.includes(scope)) throw new AppError('PERMISSION_DENIED', { title: `Esta chave não tem a permissão ${scope}. Crie uma chave com ela em Configurações › API.` });
    await rl.limit(`apikey:${k.id}`, 120, 60);
    await rl.hit(`apiuse:${k.id}:${new Date().toISOString().slice(0, 10)}`, 2 * 86400); // chamadas do dia, mostradas no painel
    if (!k.last_used_at || Date.now() - k.last_used_at.getTime() > 60_000) {
      await this.prisma.api_keys.update({ where: { id: k.id }, data: { last_used_at: new Date(), last_used_ip_hash: hashIp(trustedClientIp(req as any)) } });
    }
    req.apiKey = { keyId: k.id, workspaceId: k.workspace_id, scopes: k.scopes };
    return true;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<AuthSpec>(AUTH_KEY, [ctx.getHandler(), ctx.getClass()]) ?? { kind: 'public' };
    const req = ctx.switchToHttp().getRequest<Req>();
    if (spec.kind === 'public') return true;
    if (spec.kind === 'apikey') return this.apiKey(req, spec.scope);

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'domma') {
      throw new AppError('PERMISSION_DENIED', { title: 'Requisição inválida (CSRF).' });
    }

    if (spec.kind === 'customer') {
      const tok = req.cookies?.dm_customer;
      if (!tok) throw new AppError('UNAUTHENTICATED');
      const s = await this.prisma.customer_sessions.findUnique({ where: { token_hash: sha256(tok) } });
      if (!s || s.revoked_at || s.expires_at < new Date()) throw new AppError('UNAUTHENTICATED');
      const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: s.customer_id } });
      // RN-82: sessão de 30 dias renovada a cada uso
      if (s.expires_at.getTime() - Date.now() < 29 * 86400000) {
        await this.prisma.customer_sessions.update({ where: { id: s.id }, data: { expires_at: new Date(Date.now() + 30 * 86400000) } });
      }
      req.customer = { customerId: c.id, email: c.email, sessionId: s.id };
      return true;
    }

    const tok = req.cookies?.dm_session;
    if (!tok) throw new AppError('UNAUTHENTICATED');
    const s = await this.prisma.sessions.findUnique({ where: { token_hash: sha256(tok) }, include: { user: true } });
    if (!s || s.revoked_at || s.expires_at < new Date() || s.user.status !== 'active') throw new AppError('UNAUTHENTICATED');
    const financial = (req.path || '').startsWith('/v1/finance');
    if (financial && Date.now() - s.last_seen_at.getTime() > INACTIVITY_MS) throw new AppError('UNAUTHENTICATED');
    if (Date.now() - s.last_seen_at.getTime() > 60_000) {
      await this.prisma.sessions.update({ where: { id: s.id }, data: { last_seen_at: new Date() } });
    }

    if (spec.kind === 'admin') {
      const perms = PLATFORM_PERMS[s.user.platform_role] ?? [];
      if (!perms.length) throw new AppError('PERMISSION_DENIED');
      if (!s.user.totp_enabled_at) throw new AppError('TWO_FACTOR_REQUIRED'); // 2FA obrigatório para internos
      if (spec.perm && !perms.includes(spec.perm)) throw new AppError('PERMISSION_DENIED');
      req.producer = { userId: s.user.id, email: s.user.email, name: s.user.name, workspaceId: '', role: 'platform', permissions: perms, platformRole: s.user.platform_role, sessionId: s.id, totpEnabled: true };
      return true;
    }

    const wsHeader = req.headers['x-workspace-id'] as string | undefined;
    const memberships = await this.prisma.memberships.findMany({ where: { user_id: s.user_id }, orderBy: { created_at: 'asc' } });
    const m = (wsHeader && memberships.find(x => x.workspace_id === wsHeader)) || memberships.find(x => x.role === 'owner') || memberships[0];
    if (!m) throw new AppError('PERMISSION_DENIED');
    const permissions = m.role === 'owner' ? [...ALL_PERMISSIONS] : m.permissions;
    if (spec.perm && !permissions.includes(spec.perm)) throw new AppError('PERMISSION_DENIED');
    req.producer = {
      userId: s.user.id, email: s.user.email, name: s.user.name, workspaceId: m.workspace_id, role: m.role,
      permissions, platformRole: s.user.platform_role, sessionId: s.id, totpEnabled: !!s.user.totp_enabled_at,
    };
    return true;
  }
}
