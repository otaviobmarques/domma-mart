'use client';
/**
 * Tokenização no navegador (P4, RN-63). O número do cartão vai direto do navegador para o gateway,
 * que devolve um token de uso único; a API da Domma só recebe o token.
 *  - pagarme: POST https://api.pagar.me/core/v5/tokens?appId=<chave pública> (o domínio do checkout
 *    precisa estar cadastrado no painel da Pagar.me).
 *  - sandbox: token local de teste (só funciona com o gateway sandbox).
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

export type GatewayConfig = { provider: string; publicKey?: string | null };

export async function tokenizeCard(card: { number: string; exp: string; cvv: string; name: string }, gw: GatewayConfig = { provider: 'sandbox' }): Promise<{ token: string; brand: string; last4: string }> {
  const num = card.number.replace(/\D/g, '');
  const [mm, yy] = card.exp.split('/').map(Number);
  const now = new Date();
  if (!luhn(num)) throw new Error('Confira o número do cartão.');
  if (!mm || mm > 12 || !yy || new Date(2000 + yy, mm, 0) < new Date(now.getFullYear(), now.getMonth(), 1)) throw new Error('Confira a validade do cartão.');
  if (!/^\d{3,4}$/.test(card.cvv)) throw new Error('Confira o código de segurança (CVV).');
  const brand = brandOf(num) ?? 'card';
  if (gw.provider === 'pagarme') return tokenizePagarme({ num, mm, yy, cvv: card.cvv, name: card.name, brand }, gw.publicKey);
  if (gw.provider !== 'sandbox') throw new Error('Pagamento com cartão indisponível no momento.');
  const payload = { last4: num.slice(-4), brand, scenario: SCENARIOS[num] ?? 'approve' };
  const token = 'tok_sbx_' + btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token, brand, last4: payload.last4 };
}

async function tokenizePagarme(c: { num: string; mm: number; yy: number; cvv: string; name: string; brand: string }, publicKey?: string | null) {
  if (!publicKey?.startsWith('pk_')) throw new Error('Pagamento com cartão indisponível no momento.');
  let r: Response;
  try {
    // só Content-Type: a rota de token não aceita o cabeçalho Authorization (a chave pública vai no appId)
    r = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card', card: { number: c.num, holder_name: c.name.trim().slice(0, 64), exp_month: c.mm, exp_year: c.yy, cvv: c.cvv } }),
    });
  } catch { throw new Error('Não conseguimos falar com o banco. Confira sua internet e tente de novo.'); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.id) throw new Error(r.status === 422 ? 'Confira os dados do cartão.' : 'Não conseguimos validar o cartão. Tente de novo.');
  return { token: String(j.id), brand: String(j.card?.brand || c.brand).toLowerCase(), last4: j.card?.last_four_digits ?? c.num.slice(-4) };
}
