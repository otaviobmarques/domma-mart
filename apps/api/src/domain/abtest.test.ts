import { describe, it, expect } from 'vitest';
import { assign, normCdf, compare, missingVisitors, Arm } from './abtest';

const arm = (visitors: number, sales: number, ticket = 19700): Arm => ({ visitors, sales, revenue: sales * ticket, revenueSq: sales * ticket * ticket });

describe('teste A/B', () => {
  it('sorteio respeita a divisão', () => {
    expect(assign(50, 0.49)).toBe('b'); expect(assign(50, 0.5)).toBe('a');
    expect(assign(0, 0)).toBe('a'); expect(assign(100, 0.999)).toBe('b');
    let b = 0; for (let i = 0; i < 10000; i++) if (assign(30, i / 10000) === 'b') b++;
    expect(b).toBe(3000);
  });
  it('normal padrão', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.645)).toBeCloseTo(0.05, 3);
  });
  it('B claramente melhor em conversão → vence com 95%', () => {
    const r = compare(arm(2000, 40), arm(2000, 80), 'conversion');
    expect(r.chance_b_better).toBeGreaterThan(0.99);
    expect(r.leader).toBe('b');
    expect(r.lift).toBeCloseTo(1, 5); // +100%
  });
  it('diferença pequena → sem vencedor', () => {
    const r = compare(arm(1000, 30), arm(1000, 33), 'conversion');
    expect(r.leader).toBeNull();
    expect(r.chance_b_better).toBeGreaterThan(0.5);
    expect(r.chance_b_better).toBeLessThan(0.95);
  });
  it('amostra pequena nunca declara vencedor', () => {
    const r = compare(arm(50, 1), arm(50, 10), 'conversion');
    expect(r.enough_data).toBe(false);
    expect(r.leader).toBeNull();
    expect(missingVisitors(arm(50, 1), arm(80, 2))).toBe(50);
  });
  it('receita por visitante: preço maior com menos vendas pode vencer', () => {
    // A: R$ 97, 6% de conversão; B: R$ 197, 4% → B fatura mais por visitante
    const r = compare(arm(3000, 180, 9700), arm(3000, 120, 19700), 'revenue');
    expect(r.b).toBeGreaterThan(r.a);
    expect(r.leader).toBe('b');
    // na conversão, A é melhor
    expect(compare(arm(3000, 180, 9700), arm(3000, 120, 19700), 'conversion').leader).toBe('a');
  });
  it('sem visitantes não quebra', () => {
    expect(compare(arm(0, 0), arm(0, 0), 'conversion')).toMatchObject({ chance_b_better: 0.5, leader: null, lift: null });
  });
});
