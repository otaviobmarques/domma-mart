import { randomBytes } from 'node:crypto';

/** Permissões de uma chave da API pública. Leitura separada de escrita; dados pessoais à parte. */
export const SCOPES = {
  'sales:read': 'Ver vendas, reembolsos e assinaturas (nome e e-mail do comprador)',
  'customers:read': 'Ver dados pessoais completos dos compradores (telefone e CPF)',
  'products:read': 'Ver produtos, ofertas e cupons',
  'affiliates:read': 'Ver afiliados e comissões',
  'coupons:write': 'Criar e desativar cupons',
  'webhooks:write': 'Criar e remover webhooks (usado por Zapier e n8n)',
} as const;
export type Scope = keyof typeof SCOPES;
export const SCOPE_KEYS = Object.keys(SCOPES) as [Scope, ...Scope[]];

const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789'; // sem caracteres parecidos (l/1, o/0)
const pick = (n: number) => Array.from(randomBytes(n), b => ALPHA[b % ALPHA.length]).join('');

/** Gera uma chave: dm_live_<prefixo 10>_<segredo 32>. O prefixo identifica; o segredo nunca é guardado. */
export function newApiKey() {
  const prefix = pick(10);
  return { prefix, key: `dm_live_${prefix}_${pick(32)}` };
}

/** Separa o prefixo de uma chave recebida (formato errado → null). */
export function parseApiKey(raw: string | undefined): { prefix: string; key: string } | null {
  const m = /^dm_live_([a-z0-9]{10})_([a-z0-9]{32})$/.exec((raw ?? '').trim());
  return m ? { prefix: m[1], key: m[0] } : null;
}

/** Cursor de paginação: o id do último item (UUID v7 segue a ordem de criação). */
export function pageArgs(q: { cursor?: string; limit?: string }) {
  const limit = Math.max(1, Math.min(100, Math.floor(Number(q.limit) || 50)));
  const cursor = q.cursor && /^[0-9a-f-]{36}$/i.test(q.cursor) ? q.cursor : undefined;
  return { limit, cursor };
}
export function page<T extends { id: string }>(rows: T[], limit: number) {
  const has_more = rows.length > limit;
  const data = rows.slice(0, limit);
  return { data, has_more, next_cursor: has_more ? data[data.length - 1].id : null };
}
