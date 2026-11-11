import { describe, it, expect } from 'vitest';
import { canonical } from './audit.service';

describe('auditoria — JSON canônico do hash encadeado', () => {
  it('independe da ordem das chaves (jsonb reordena ao gravar)', () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(canonical({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  });
  it('normaliza bigint, undefined e datas', () => {
    expect(canonical({ v: 10n, u: undefined, d: new Date('2026-11-11T00:00:00Z') })).toBe('{"d":"2026-11-11T00:00:00.000Z","u":null,"v":"10"}');
  });
});
