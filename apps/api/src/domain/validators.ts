/** Validações de entrada do checkout (tela 19.1). */
export function onlyDigits(s: string): string { return (s || '').replace(/\D/g, ''); }

export function isValidCPF(raw: string): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export function isValidCNPJ(raw: string): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((s, wi, i) => s + wi * Number(c[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export function isValidDocument(raw: string): boolean {
  const d = onlyDigits(raw);
  return d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false;
}

const VALID_DDD = new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);

/** Celular BR: DDD válido + 9 dígitos começando com 9. Retorna E.164 ou null. */
export function normalizeBRMobile(raw: string): string | null {
  let d = onlyDigits(raw);
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 11) return null;
  if (!VALID_DDD.has(Number(d.slice(0, 2))) || d[2] !== '9') return null;
  return '+55' + d;
}

export function isValidName(name: string): boolean {
  const n = (name || '').trim();
  return n.length >= 3 && n.length <= 120 && n.split(/\s+/).filter(p => p.length > 0).length >= 2;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmailFormat(e: string): boolean { return EMAIL_RE.test((e || '').trim()); }

const COMMON = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br', 'yahoo.com', 'icloud.com', 'live.com', 'uol.com.br', 'bol.com.br', 'terra.com.br'];
function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** “gmial.com” → “gmail.com” (tela 19.1). */
export function suggestEmailDomain(email: string): string | null {
  const [user, domain] = (email || '').toLowerCase().split('@');
  if (!user || !domain || COMMON.includes(domain)) return null;
  for (const c of COMMON) if (lev(domain, c) <= 2) return `${user}@${c}`;
  return null;
}

export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'throwawaymail.com',
]);
export function isDisposableEmail(email: string): boolean {
  return DISPOSABLE_DOMAINS.has((email.split('@')[1] || '').toLowerCase());
}

/** Moderação automática de termos proibidos (RN-65, seção 10). */
const PROHIBITED = ['fique rico', 'enriquecimento rápido', 'dinheiro fácil', 'renda garantida', 'pirataria', 'crackeado', 'aposta garantida', 'cassino', 'conteúdo adulto', 'arma de fogo', 'hackear conta', 'cura do câncer'];
export function moderationFlags(text: string): string[] {
  const t = (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return PROHIBITED.filter(p => t.includes(p.normalize('NFD').replace(/[̀-ͯ]/g, '')));
}

export function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}***@${d}`;
}
export function maskDocument(d: string): string {
  const x = onlyDigits(d);
  return x.length === 11 ? `***.${x.slice(3, 6)}.***-**` : `**.***.${x.slice(5, 8)}/****-**`;
}
export function maskPhone(p: string): string {
  const x = onlyDigits(p);
  return `(${x.slice(-11, -9)}) *****-${x.slice(-4)}`;
}
