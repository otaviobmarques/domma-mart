'use client';
/** Cliente da API (mesma origem via rewrite). Erros chegam como problem+json (seção 23). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, public title: string, public fields: Record<string, string> = {}, public data: any = {}) { super(title); }
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
}

type Opts = { idem?: string | true; otp?: string; headers?: Record<string, string>; signal?: AbortSignal };

export async function api<T = any>(method: string, path: string, body?: unknown, o: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'domma', ...o.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (o.idem) headers['idempotency-key'] = o.idem === true ? uuid() : o.idem;
  if (o.otp) headers['x-otp'] = o.otp;
  const ws = typeof window !== 'undefined' ? localStorage.getItem('dm_ws') : null;
  if (ws) headers['x-workspace-id'] = ws;
  let r: Response;
  try {
    r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: o.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    window.dispatchEvent(new Event('dm:offline'));
    throw new ApiError(0, 'NETWORK', 'Sem conexão. Tentando de novo…');
  }
  window.dispatchEvent(new Event('dm:online'));
  const text = await r.text();
  const data = text ? safeJson(text) : null;
  if (!r.ok) {
    if (r.status === 401 && data?.code === 'UNAUTHENTICATED' && typeof window !== 'undefined' && !path.startsWith('/v1/customer') && !path.startsWith('/v1/members')) {
      const back = encodeURIComponent(location.pathname + location.search);
      if (!location.pathname.startsWith('/entrar')) location.href = `/entrar?volta=${back}`;
    }
    throw new ApiError(r.status, data?.code ?? 'INTERNAL_ERROR', data?.title ?? 'Algo deu errado do nosso lado. Tente de novo em instantes.', data?.fields ?? {}, data ?? {});
  }
  return data as T;
}
function safeJson(t: string) { try { return JSON.parse(t); } catch { return t; } }

export const get = <T = any>(p: string, o?: Opts) => api<T>('GET', p, undefined, o);
export const post = <T = any>(p: string, b?: unknown, o?: Opts) => api<T>('POST', p, b ?? {}, o);
