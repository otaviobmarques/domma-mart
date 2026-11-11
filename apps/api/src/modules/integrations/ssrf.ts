import { lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

/**
 * Proteção contra SSRF nos webhooks de saída (seção 11.5). Bloqueia redes privadas, loopback, link-local,
 * CGNAT, multicast, reservados, NAT64 e IPv4 mapeado em IPv6. A checagem acontece na própria conexão
 * (lookup do socket), então um DNS que muda entre a validação e a chamada (rebinding) não passa.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** IPv4 escondido em IPv6 (::ffff:a.b.c.d, ::ffff:7f00:1, NAT64 64:ff9b::a.b.c.d) volta a ser IPv4 para a checagem. */
function embeddedV4(ip: string): string | null {
  const x = ip.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
  if (hex) { const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return null;
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) { const v4 = embeddedV4(ip); return (v4 ? blocked.check(v4, 'ipv4') : false) || blocked.check(ip, 'ipv6'); }
  return true;
}

function allowPrivate() { return process.env.NODE_ENV !== 'production' && process.env.ALLOW_PRIVATE_WEBHOOKS === '1'; }

/** Validação no cadastro do webhook (resposta rápida ao produtor). A garantia real está em safePost. */
export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && u.protocol === 'http:')) return false;
  if (u.username || u.password) return false;
  if (allowPrivate()) return true;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  try {
    const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map(r => r.address);
    return ips.length > 0 && ips.every(ip => !isPrivateIp(ip));
  } catch { return false; }
}

/** DNS do socket: recusa se qualquer endereço resolvido for interno. */
const safeLookup: typeof dnsLookup = ((hostname: string, options: any, cb: any) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const list = (Array.isArray(addrs) ? addrs : [{ address: addrs, family: options?.family || 4 }]) as { address: string; family: number }[];
    if (!allowPrivate() && (!list.length || list.some(a => isPrivateIp(a.address)))) return cb(Object.assign(new Error('destino bloqueado (rede interna)'), { code: 'EBLOCKED' }));
    if (options?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as any;

/** POST para um webhook de terceiro: sem seguir redirecionamento, com tempo máximo e IP checado na conexão. */
export function safePost(raw: string, headers: Record<string, string>, body: string, timeoutMs = 10_000): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(raw); } catch { return reject(new Error('URL inválida')); }
    if (u.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && u.protocol === 'http:')) return reject(new Error('só https'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isPrivateIp(host) && !allowPrivate()) return reject(new Error('destino bloqueado (rede interna)'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() }, lookup: safeLookup, timeout: timeoutMs }, (res) => {
      res.resume(); // corpo da resposta não interessa (nem é devolvido ao produtor)
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end(body);
  });
}
