import { describe, it, expect } from 'vitest';
import { affiliateEarning, temperature, publicName } from './marketplace';
import { delistReason, DEFAULT_RISK } from './risk';
import { computeFee, computeSplit } from './money';

describe('vitrine de afiliados', () => {
  it('ganho do afiliado = comissão sobre o valor depois da taxa de venda por afiliado', () => {
    const fee = computeFee({ baseCents: 19700n, method: 'pix', viaAffiliate: true }).feeCents;
    const parts = computeSplit({ baseCents: 19700n, interestCents: 0n, absorbedCostCents: 0n, feeCents: fee, producerId: 'p', affiliate: { id: 'a', bps: 4000 }, coproducers: [] });
    expect(affiliateEarning(19700n, 4000)).toBe(parts.find(p => p.beneficiary_type === 'affiliate')!.amount_cents);
    expect(affiliateEarning(19700n, 4000)).toBeGreaterThan(0n);
    expect(affiliateEarning(19700n, 5000)).toBeGreaterThan(affiliateEarning(19700n, 4000));
  });
  it('temperatura cresce com as vendas e para em 100', () => {
    expect(temperature(0)).toBe(0);
    expect(temperature(1)).toBeLessThan(temperature(10));
    expect(temperature(10)).toBeLessThan(temperature(100));
    expect(temperature(1_000_000)).toBe(100);
  });
  it('ranking mostra só primeiro nome e inicial', () => {
    expect(publicName('Bruno Souza Lima')).toBe('Bruno L.');
    expect(publicName('Ana')).toBe('Ana');
    expect(publicName('  ')).toBe('Afiliado');
  });
});

describe('saída automática da vitrine', () => {
  const m = DEFAULT_RISK.marketplace;
  it('sem volume mínimo, não tira', () => expect(delistReason({ sales: 5, refunds: 5, chargebacks: 5 }, m)).toBeNull());
  it('reembolso alto tira', () => expect(delistReason({ sales: 100, refunds: 20, chargebacks: 0 }, m)).toMatch(/reembolso de 20.0%/));
  it('chargeback alto tira (antes do reembolso)', () => expect(delistReason({ sales: 100, refunds: 30, chargebacks: 2 }, m)).toMatch(/chargeback de 2.0%/));
  it('dentro dos limites, fica', () => expect(delistReason({ sales: 100, refunds: 10, chargebacks: 1 }, m)).toBeNull());
});
