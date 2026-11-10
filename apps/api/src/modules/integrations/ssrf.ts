import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Bloqueia destinos internos nos webhooks de saída (proteção contra SSRF, seção 11.5). */
function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const x = ip.toLowerCase();
    return x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.') || x === '::';
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && u.protocol === 'http:')) return false;
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_WEBHOOKS === '1') return true;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map(r => r.address);
  return ips.length > 0 && ips.every(ip => !isPrivate(ip));
}
