import type { Request, Response, NextFunction } from 'express';
import { isIP } from 'node:net';
import { safeEqual } from '../common/crypto';

/**
 * Só o site (Vercel) fala com a API. O proxy do site carimba cada requisição com EDGE_SECRET
 * (cabeçalho x-domma-edge) e com o IP real do comprador (x-domma-client-ip), que a Vercel conhece.
 * Quem chamar a API direto (ex.: o domínio público do Railway) não tem o carimbo e é recusado, então
 * não consegue escolher o próprio IP nem o domínio (x-dm-host) para furar limites e antifraude.
 * Exceções: /health (verificação do Railway) e /webhooks/* (gateways chamam direto e têm assinatura própria).
 * Sem EDGE_SECRET (desenvolvimento, CI, teste de carga) vale o comportamento antigo: confia nos cabeçalhos.
 */
const OPEN = /^\/(health\/?$|webhooks\/)/;

export function edgeGuard(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.EDGE_SECRET;
  if (!secret) return next();
  const got = String(req.headers['x-domma-edge'] || '');
  if (got && safeEqual(got, secret)) { (req as any).edgeVerified = true; return next(); }
  if (OPEN.test(req.path)) return next();
  res.status(403).type('application/problem+json').send(JSON.stringify({ type: 'about:blank', title: 'Acesso direto à API não é permitido.', status: 403, code: 'PERMISSION_DENIED' }));
}

export const edgeEnforced = () => !!process.env.EDGE_SECRET;

/** IP do cliente: com o carimbo do site, o IP que o site viu; sem EDGE_SECRET, os cabeçalhos de proxy (modo antigo). */
export function trustedClientIp(req: Request): string {
  const socket = req.socket?.remoteAddress || '0.0.0.0';
  if (edgeEnforced()) {
    if (!(req as any).edgeVerified) return socket;
    const ip = String(req.headers['x-domma-client-ip'] || '').trim();
    return isIP(ip) ? ip : socket;
  }
  return (req.headers['cf-connecting-ip'] as string) || (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || socket;
}

/** Domínio que o comprador está usando, só quando veio do site (ou sem EDGE_SECRET). */
export function trustedHostHeader(req: Request): string | undefined {
  if (edgeEnforced() && !(req as any).edgeVerified) return undefined;
  const h = (req.headers['x-dm-host'] as string) || '';
  return h.split(',')[0].trim().toLowerCase() || undefined;
}

/** País do IP (ISO, 2 letras), só quando veio do site. Sem EDGE_SECRET (dev/CI), aceita o cabeçalho para testes. */
export function trustedClientCountry(req: Request): string | undefined {
  if (edgeEnforced() && !(req as any).edgeVerified) return undefined;
  const c = String(req.headers['x-domma-client-country'] || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : undefined;
}
