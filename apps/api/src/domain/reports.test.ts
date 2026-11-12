import { describe, it, expect } from 'vitest';
import { monthKey, addMonths, monthDiff, lastMonths, customerCohorts, monthly, subscriptionSeries, subscriptionCohorts, subscriptionSummary, monthStart, Sub } from './reports';

const now = new Date('2026-11-12T15:00:00Z');
describe('meses (Brasília)', () => {
  it('chave do mês no fuso de Brasília', () => {
    expect(monthKey(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10'); // 23h de 31/10 em Brasília
    expect(monthKey(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11');
  });
  it('somar e diferença de meses atravessando o ano', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthDiff('2025-12', '2026-02')).toBe(2);
    expect(lastMonths(3, now)).toEqual(['2026-09', '2026-10', '2026-11']);
  });
});

describe('coortes de clientes e LTV', () => {
  const cells = [
    { cohort: '2026-09', k: 0, customers: 10, revenue: 100000 },
    { cohort: '2026-09', k: 1, customers: 3, revenue: 30000 },
    { cohort: '2026-09', k: 2, customers: 2, revenue: 20000 },
    { cohort: '2026-11', k: 0, customers: 4, revenue: 40000 },
  ];
  const r = customerCohorts(cells, ['2026-09', '2026-10', '2026-11'], now, 4);
  it('retenção = % da coorte que comprou de novo no mês k', () => expect(r[0].retention).toEqual([100, 30, 20, null]));
  it('LTV acumulado por cliente', () => expect(r[0].ltv_cents).toEqual([10000, 13000, 15000, null]));
  it('coorte vazia e mês que ainda não chegou', () => {
    expect(r[1]).toMatchObject({ customers: 0, retention: [100, 0, null, null] });
    expect(r[2].retention).toEqual([100, null, null, null]);
  });
});

describe('assinaturas', () => {
  const d = (s: string) => new Date(s);
  const sub = (o: Partial<Sub>): Sub => ({ created_at: d('2026-08-10T12:00:00Z'), ended_at: null, end_reason: null, price_cents: 9700, interval: 'month', status: 'active', cancel_requested_at: null, ...o });
  const subs = [
    sub({}), sub({}), sub({ interval: 'year', price_cents: 120000 }),
    sub({ ended_at: d('2026-09-15T12:00:00Z'), end_reason: 'voluntary', status: 'canceled' }),
    sub({ ended_at: d('2026-10-20T12:00:00Z'), end_reason: 'payment_failed', status: 'defaulted' }),
    sub({ created_at: d('2026-10-05T12:00:00Z'), status: 'past_due' }),
  ];
  it('valor mensal por período', () => { expect(monthly(120000, 'year')).toBe(10000); expect(monthly(29700, 'quarter')).toBe(9900); });
  const series = subscriptionSeries(subs, ['2026-09', '2026-10', '2026-11'], now);
  it('churn do mês = encerradas entre as ativas no início', () => {
    expect(series[0]).toMatchObject({ active_start: 5, ended: 1, voluntary: 1, churn_pct: 20 });
    expect(series[1]).toMatchObject({ active_start: 4, new: 1, ended: 1, payment_failed: 1, churn_pct: 25 });
  });
  it('MRR no fim do mês, com anual ÷ 12', () => expect(series[2].mrr_cents).toBe(9700 * 3 + 10000));
  it('coortes de assinantes: % ainda ativos', () => {
    const c = subscriptionCohorts(subs, ['2026-08'], now, 4);
    expect(c[0]).toMatchObject({ subscribers: 5, active_pct: [100, 80, 60, 60] });
  });
  it('resumo: MRR, ARPU, churn médio, vida média e LTV', () => {
    const s = subscriptionSummary(subs, series, now);
    expect(s).toMatchObject({ active: 4, mrr_cents: 39100, arpu_cents: 9775, past_due: 1 });
    expect(s.churn_pct).toBe(22.5); // média de set (20%) e out (25%); novembro ainda aberto
    expect(s.lifetime_months).toBeCloseTo(4.4, 1);
    expect(s.ltv_cents).toBe(Math.round(9775 * 4.4));
  });
  it('início do mês às 00:00 de Brasília', () => expect(monthStart('2026-11').toISOString()).toBe('2026-11-01T03:00:00.000Z'));
});
