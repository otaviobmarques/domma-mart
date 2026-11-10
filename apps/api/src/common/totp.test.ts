import { describe, it, expect } from 'vitest';
import { hotp, verifyTotp, totp, base32Encode } from './totp';
describe('TOTP', () => {
  it('vetor RFC 4226', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 1)).toBe('287082');
  });
  it('verifica janela atual', () => {
    const s = base32Encode(Buffer.from('abcdefghijabcdefghij'));
    expect(verifyTotp(s, totp(s))).toBe(true);
    expect(verifyTotp(s, '000000')).toBe(totp(s) === '000000');
  });
});
