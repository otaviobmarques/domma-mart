import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Criptografia de campo (seção 11.4). Em produção a chave de dados vem de envelope
 * encryption com KMS; aqui FIELD_ENCRYPTION_KEY faz o papel da DEK.
 * Formato: [1 byte versão][12 bytes IV][16 bytes tag][dados].
 */
function key(name: string): Buffer {
  const hex = process.env[name];
  if (!hex || hex.length !== 64) throw new Error(`${name} must be 32 bytes hex`);
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key('FIELD_ENCRYPTION_KEY'), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), data]);
}

export function decrypt(buf: Buffer | Uint8Array): string {
  const b = Buffer.from(buf);
  const iv = b.subarray(1, 13), tag = b.subarray(13, 29), data = b.subarray(29);
  const d = createDecipheriv('aes-256-gcm', key('FIELD_ENCRYPTION_KEY'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

/** Hash determinístico para busca sem decifrar (HMAC-SHA256). */
export function blindIndex(value: string): string {
  return createHmac('sha256', key('HMAC_KEY')).update(value.trim().toLowerCase()).digest('hex');
}

export function sha256(v: string): string { return createHash('sha256').update(v).digest('hex'); }

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }

export function hmacSign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token curto assinado (ex.: /pix/{orderId}?t=...). payload.exp em ms. */
export function signToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', key('SIGNING_KEY')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string | undefined | null): (T & { exp: number }) | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', key('SIGNING_KEY')).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function base62(len: number): string {
  const b = randomBytes(len);
  return Array.from(b, x => B62[x % 62]).join('');
}
export function orderCode(): string {
  const A = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return 'DM-' + Array.from(randomBytes(6), x => A[x % A.length]).join('');
}

export function hashIp(ip: string): string { return blindIndex('ip:' + ip); }
