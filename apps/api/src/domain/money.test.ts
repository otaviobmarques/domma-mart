import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeFee, computeSplit, installmentPlan, maxInstallmentsFor, releaseSchedule, divRoundHalfEven, applyCoupon, tierBpsFor } from './money';

describe('taxas (RN-02..RN-05)', () => {
  it('bate com a tabela da seção 14.2', () => {
    const f = (c: number, m: 'pix' | 'card' = 'card') => Number(computeFee({ baseCents: BigInt(c), method: m, viaAffiliate: false }).feeCents);
    expect(f(4700)).toBe(360);
    expect(f(9700)).toBe(585);
    expect(f(29700)).toBe(1483);
    expect(f(99700)).toBe(4626);
    expect(f(99700, 'pix')).toBe(1490); // teto Pix
  });
  it('afiliado usa 6,49%', () => {
    expect(computeFee({ baseCents: 10000n, method: 'card', viaAffiliate: true }).feeCents).toBe(649n + 149n);
  });
  it('abaixo de R$ 10 cobra R$ 1,99 fixo (RN-04)', () => {
    expect(computeFee({ baseCents: 990n, method: 'pix', viaAffiliate: false }).feeCents).toBe(199n);
  });
  it('faixas de volume (RN-05)', () => {
    expect(tierBpsFor(4_000_000n)).toBeNull();
    expect(tierBpsFor(6_000_000n)).toBe(399);
    expect(tierBpsFor(30_000_000n, 250)).toBe(250);
  });
  it('arredonda meia para o par', () => {
    expect(divRoundHalfEven(25n, 10n)).toBe(2n);
    expect(divRoundHalfEven(35n, 10n)).toBe(4n);
    expect(divRoundHalfEven(26n, 10n)).toBe(3n);
  });
});

describe('parcelamento (RN-07, RN-08)', () => {
  it('1x sem juros', () => {
    const p = installmentPlan(19700n, 1, 'buyer');
    expect(p.totalCents).toBe(19700n);
    expect(p.interestCents).toBe(0n);
  });
  it('12x com juros repassados: total = parcela × 12', () => {
    const p = installmentPlan(19700n, 12, 'buyer');
    expect(p.totalCents).toBe(p.installmentCents * 12n);
    expect(p.interestCents).toBeGreaterThan(0n);
    expect(Number(p.installmentCents)).toBeGreaterThan(1950);
    expect(Number(p.installmentCents)).toBeLessThan(2000);
  });
  it('respeita parcela mínima de R$ 5,00', () => {
    expect(maxInstallmentsFor(1000n, 12, 'buyer')).toBe(2);
    expect(maxInstallmentsFor(500n, 12, 'buyer')).toBe(1);
    expect(maxInstallmentsFor(100000n, 6, 'buyer')).toBe(6);
  });
});

describe('divisão da venda (RN-09, RN-10) — propriedades', () => {
  it('soma das partes = total cobrado, sem centavo perdido', () => {
    fc.assert(fc.property(
      fc.integer({ min: 500, max: 5_000_000 }),
      fc.integer({ min: 1, max: 12 }),
      fc.constantFrom<'pix' | 'card' | 'boleto'>('pix', 'card', 'boleto'),
      fc.constantFrom<'buyer' | 'producer'>('buyer', 'producer'),
      fc.option(fc.integer({ min: 1, max: 8000 }), { nil: null }),
      fc.array(fc.integer({ min: 1, max: 3000 }), { maxLength: 3 }),
      (price, n, method, mode, affBps, coBps) => {
        const base = BigInt(price);
        const plan = method === 'card' ? installmentPlan(base, n, mode) : installmentPlan(base, 1, mode);
        const fee = computeFee({ baseCents: base, method, viaAffiliate: affBps != null }).feeCents;
        // custo absorvido não pode passar do que sobra ao produtor; testamos só cenários válidos
        try {
          const parts = computeSplit({
            baseCents: base, interestCents: plan.interestCents, absorbedCostCents: plan.absorbedCostCents, feeCents: fee,
            producerId: 'p', affiliate: affBps ? { id: 'a', bps: affBps } : null,
            coproducers: coBps.map((b, k) => ({ id: 'c' + k, bps: b })),
          });
          const sum = parts.reduce((s, p) => s + p.amount_cents, 0n);
          expect(sum).toBe(plan.totalCents);
          for (const p of parts) expect(p.amount_cents >= 0n).toBe(true);
        } catch (e) {
          expect(String(e)).toMatch(/negative/);
        }
      }), { numRuns: 2000 });
  });
  it('juros não entram na base do afiliado (RN-10)', () => {
    const parts = computeSplit({ baseCents: 10000n, interestCents: 1500n, absorbedCostCents: 0n, feeCents: 798n, producerId: 'p', affiliate: { id: 'a', bps: 5000 } });
    expect(parts.find(p => p.beneficiary_type === 'affiliate')!.amount_cents).toBe(4601n);
    expect(parts.find(p => p.beneficiary_type === 'platform')!.amount_cents).toBe(2298n);
  });
});

describe('liberação (RN-35)', () => {
  const paid = new Date('2026-11-10T12:00:00Z');
  const g = new Date('2026-11-17T12:00:00Z');
  it('Pix: 90% D+1 e 10% no fim da garantia; soma exata', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000_000 }), (a) => {
      const s = releaseSchedule(BigInt(a), 'pix', paid, g);
      expect(s.reduce((x, y) => x + y.amount, 0n)).toBe(BigInt(a));
    }));
    const s = releaseSchedule(10000n, 'pix', paid, g);
    expect(s[0].amount).toBe(9000n);
    expect(s[1].availableAt).toEqual(g);
  });
  it('cartão D+30, boleto D+2', () => {
    expect(releaseSchedule(100n, 'card', paid, g)[0].availableAt.getTime() - paid.getTime()).toBe(30 * 86400000);
    expect(releaseSchedule(100n, 'boleto', paid, g)[0].availableAt.getTime() - paid.getTime()).toBe(2 * 86400000);
  });
});

describe('cupom (RN-20..22)', () => {
  it('nunca deixa abaixo de R$ 5,00', () => {
    expect(applyCoupon(1000n, { kind: 'fixed', value: 900 })).toBe(500n);
    expect(applyCoupon(10000n, { kind: 'percent', value: 1000 })).toBe(1000n);
  });
});
