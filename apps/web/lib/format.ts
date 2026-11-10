/** Valores e datas (19.0): R$ 1.234,56; fuso America/Sao_Paulo; "há 5 min". */
const TZ = 'America/Sao_Paulo';
export const brl = (cents: number | bigint | null | undefined) =>
  (Number(cents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function shortDate(d: string | Date) {
  const x = new Date(d);
  const sameYear = x.toLocaleString('pt-BR', { timeZone: TZ, year: 'numeric' }) === new Date().toLocaleString('pt-BR', { timeZone: TZ, year: 'numeric' });
  return x.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: 'numeric' }) });
}
export function dateTime(d: string | Date) {
  return new Date(d).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function ago(d: string | Date) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `há ${Math.floor(s / 86400)} ${Math.floor(s / 86400) === 1 ? 'dia' : 'dias'}`;
  return shortDate(d);
}
export const methodLabel = (m: string) => ({ pix: 'Pix', card: 'Cartão', boleto: 'Boleto' } as Record<string, string>)[m] ?? m;
export const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR')}%`;

/** Máscaras do checkout (19.1). */
export const digits = (s: string) => s.replace(/\D/g, '');
export function maskDoc(v: string) {
  const d = digits(v).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
export function maskPhone(v: string) {
  const d = digits(v).replace(/^55(?=\d{11})/, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export function maskMoney(v: string) {
  const d = digits(v).slice(0, 9);
  return d ? (Number(d) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
}
export const moneyToCents = (v: string) => Number(digits(v) || 0);

export function isValidCPF(raw: string) {
  const c = digits(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => { let s = 0; for (let i = 0; i < len; i++) s += Number(c[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}
export function isValidCNPJ(raw: string) {
  const c = digits(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => { const w = len === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const s = w.reduce((a, wi, i) => a + wi * Number(c[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}
const COMMON = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br', 'yahoo.com', 'icloud.com', 'live.com', 'uol.com.br', 'bol.com.br'];
function lev(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[a.length][b.length];
}
export function emailSuggestion(e: string) {
  const [u, d] = e.toLowerCase().split('@');
  if (!u || !d || COMMON.includes(d)) return null;
  for (const c of COMMON) if (lev(d, c) <= 2) return `${u}@${c}`;
  return null;
}
