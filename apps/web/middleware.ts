import { NextRequest, NextResponse } from 'next/server';

/**
 * Domínio próprio do produtor (5.3): em pay.produtor.com.br/{slug} mostra o checkout daquela oferta.
 * Nesses domínios só ficam abertas as telas do comprador; painel e back-office não existem lá.
 */
const API = process.env.API_URL || 'http://127.0.0.1:4000';
const MAIN = (process.env.MAIN_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
const BUYER_PREFIXES = ['/pay/', '/pix/', '/obrigado/', '/boleto/', '/minhas-compras', '/curso', '/cursos', '/certificado/', '/descadastro', '/termos', '/privacidade', '/v1/', '/r/', '/webhooks/'];
const cache = new Map<string, { ok: boolean; at: number }>();
// rotas do painel, back-office e conta: nunca viram "código de oferta" num domínio de produtor
const PANEL_ROUTES = new Set(['inicio', 'produtos', 'vendas', 'financeiro', 'afiliados', 'afiliado', 'afiliar', 'configuracoes', 'identidade', 'socios', 'admin', 'entrar', 'criar', 'criarconta', 'dev', 'esqueci', 'nova', 'confirmar']);

function isMainHost(host: string) {
  return MAIN.includes(host) || host === 'localhost' || host.startsWith('127.') || host.endsWith('.vercel.app') || host.endsWith('.up.railway.app');
}

async function isActiveDomain(host: string) {
  const c = cache.get(host);
  if (c && Date.now() - c.at < 60_000) return c.ok;
  let ok = false;
  try { ok = (await fetch(`${API}/v1/public/domains/${encodeURIComponent(host)}`, { cache: 'no-store' })).ok; } catch { ok = c?.ok ?? false; }
  cache.set(host, { ok, at: Date.now() });
  return ok;
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  if (!host || isMainHost(host)) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/_next/') || /\.(svg|png|ico|webmanifest|js|css|txt)$/.test(pathname)) return NextResponse.next();

  if (!(await isActiveDomain(host))) return NextResponse.rewrite(new URL('/dominio-nao-configurado', req.url));

  // a API confere que a oferta pertence ao dono deste domínio
  const headers = new Headers(req.headers);
  headers.set('x-dm-host', host);
  if (BUYER_PREFIXES.some(p => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))) return NextResponse.next({ request: { headers } });
  const slug = /^\/([A-Za-z0-9]{3,40})\/?$/.exec(pathname)?.[1];
  if (slug && !PANEL_ROUTES.has(slug.toLowerCase())) {
    const url = req.nextUrl.clone();
    url.pathname = `/pay/${slug}`;
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (pathname === '/') return NextResponse.rewrite(new URL('/minhas-compras/entrar', req.url), { request: { headers } });
  return NextResponse.rewrite(new URL('/dominio-nao-configurado', req.url));
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
