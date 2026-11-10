import { createHmac, randomBytes } from 'node:crypto';

/** TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos) — compatível com Google Authenticator/Authy. */
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHA.indexOf(ch); if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateSecret(): string { return base32Encode(randomBytes(20)); }

export function hotp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

export function totp(secret: string, at = Date.now()): string { return hotp(secret, Math.floor(at / 30_000)); }

/** Aceita ±1 janela para tolerar relógio. */
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code || '')) return false;
  const c = Math.floor(at / 30_000);
  return [c - 1, c, c + 1].some(x => hotp(secret, x) === code);
}

export function otpauthUrl(secret: string, label: string): string {
  return `otpauth://totp/${encodeURIComponent('Domma Mart:' + label)}?secret=${secret}&issuer=${encodeURIComponent('Domma Mart')}`;
}
