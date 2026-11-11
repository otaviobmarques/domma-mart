import { describe, it, expect } from 'vitest';
import { newApiKey, parseApiKey, pageArgs, page } from './api-keys';
import { sampleEvent, WEBHOOK_EVENTS } from './webhook-events';

describe('chaves da API pública', () => {
  it('formato dm_live_<prefixo>_<segredo> e sempre diferentes', () => {
    const a = newApiKey(), b = newApiKey();
    expect(a.key).toMatch(/^dm_live_[a-z0-9]{10}_[a-z0-9]{32}$/);
    expect(a.key.startsWith(`dm_live_${a.prefix}_`)).toBe(true);
    expect(a.key).not.toBe(b.key);
  });
  it('lê a chave e recusa formatos errados', () => {
    const { key, prefix } = newApiKey();
    expect(parseApiKey(key)).toEqual({ prefix, key });
    expect(parseApiKey(` ${key} `)?.prefix).toBe(prefix);
    for (const bad of [undefined, '', 'dm_live_abc', key + 'x', key.replace('dm_live_', 'dm_test_'), key.toUpperCase()]) expect(parseApiKey(bad)).toBeNull();
  });
  it('paginação: limite entre 1 e 100, cursor só UUID', () => {
    expect(pageArgs({})).toEqual({ limit: 50, cursor: undefined });
    expect(pageArgs({ limit: '500' }).limit).toBe(100);
    expect(pageArgs({ limit: '0' }).limit).toBe(50);
    expect(pageArgs({ cursor: "x' OR 1=1" }).cursor).toBeUndefined();
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id${i}` }));
    expect(page(rows, 2)).toEqual({ data: rows.slice(0, 2), has_more: true, next_cursor: 'id1' });
    expect(page(rows, 5)).toEqual({ data: rows, has_more: false, next_cursor: null });
  });
  it('exemplo de cada evento de webhook', () => {
    for (const t of WEBHOOK_EVENTS) expect(sampleEvent(t)).toMatchObject({ type: t, test: true, data: expect.any(Object) });
  });
});
