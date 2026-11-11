/**
 * Domínios do produtor no projeto do Vercel (SSL automático). Precisa de VERCEL_TOKEN,
 * VERCEL_PROJECT_ID e VERCEL_TEAM_ID na API. VERCEL_API_URL só existe para testes.
 */
export const domainsEnabled = () => !!(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);

const base = () => process.env.VERCEL_API_URL || 'https://api.vercel.com';
const team = () => (process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '');
const pid = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID!);

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base()}${path}${team()}`, {
    method, headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  });
  const data: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export type VerificationRecord = { type: string; domain: string; value: string; reason?: string };

export async function addDomain(host: string) {
  const r = await call('POST', `/v10/projects/${pid()}/domains`, { name: host });
  // 409 = já está no projeto: segue para a verificação
  if (!r.ok && r.status !== 409) throw new Error(r.data?.error?.message || `Vercel ${r.status}`);
  return { verified: !!r.data?.verified, verification: (r.data?.verification ?? []) as VerificationRecord[] };
}

export async function checkDomain(host: string) {
  const v = await call('POST', `/v9/projects/${pid()}/domains/${encodeURIComponent(host)}/verify`);
  const c = await call('GET', `/v6/domains/${encodeURIComponent(host)}/config`);
  return { verified: !!v.data?.verified, misconfigured: c.ok ? !!c.data?.misconfigured : true, verification: (v.data?.verification ?? []) as VerificationRecord[] };
}

export async function removeDomain(host: string) {
  await call('DELETE', `/v9/projects/${pid()}/domains/${encodeURIComponent(host)}`);
}

/** Registros que o produtor cria no DNS: CNAME para subdomínio, A para domínio raiz. */
export function dnsRecords(host: string, verification: VerificationRecord[]) {
  const labels = host.split('.');
  const isApex = labels.length === 2 || (labels.length === 3 && /^(com|net|org|gov|edu)\.br$/.test(labels.slice(1).join('.')));
  const route = isApex
    ? { type: 'A', name: '@', value: '76.76.21.21' }
    : { type: 'CNAME', name: labels.slice(0, labels.length - (host.endsWith('.br') && labels.length > 3 ? 3 : 2)).join('.'), value: 'cname.vercel-dns.com' };
  return [route, ...verification.map(v => ({ type: v.type, name: v.domain, value: v.value }))];
}
