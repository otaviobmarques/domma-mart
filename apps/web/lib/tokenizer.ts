'use client';
/**
 * Tokenização no navegador (P4, RN-63). Em produção este módulo é substituído pelo SDK/JS do
 * gateway escolhido (ex.: Asaas/Pagar.me), que renderiza os campos e devolve um token de uso único.
 * O número do cartão NUNCA é enviado à API da Domma — só o token.
 * Implementação atual: tokenizador do SANDBOX (só funciona com o gateway sandbox).
 */
export function luhn(num: string) {
  const d = num.replace(/\D/g, '');
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = Number(d[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return d.length >= 13 && sum % 10 === 0;
}
export function brandOf(num: string): string | null {
  const d = num.replace(/\D/g, '');
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d)) return 'elo';
  if (/^(606282|3841)/.test(d)) return 'hipercard';
  return null;
}
const SCENARIOS: Record<string, string> = { '4000000000000002': 'decline', '4000000000009995': 'funds', '4000000000000069': 'expired', '4000000000000127': 'cvv', '4000000000004954': 'risk' };

export async function tokenizeCard(card: { number: string; exp: string; cvv: string; name: string }): Promise<{ token: string; brand: string; last4: string }> {
  const num = card.number.replace(/\D/g, '');
  const [mm, yy] = card.exp.split('/').map(Number);
  const now = new Date();
  if (!luhn(num)) throw new Error('Confira o número do cartão.');
  if (!mm || mm > 12 || !yy || new Date(2000 + yy, mm, 0) < new Date(now.getFullYear(), now.getMonth(), 1)) throw new Error('Confira a validade do cartão.');
  if (!/^\d{3,4}$/.test(card.cvv)) throw new Error('Confira o código de segurança (CVV).');
  const brand = brandOf(num) ?? 'card';
  const payload = { last4: num.slice(-4), brand, scenario: SCENARIOS[num] ?? 'approve' };
  const token = 'tok_sbx_' + btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token, brand, last4: payload.last4 };
}
