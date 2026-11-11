import { describe, it, expect } from 'vitest';
import { DEFAULT_RISK, mergeConfig, scoreRules, gatewaySignal, total, decide, validBands, reserveFor, applyReserve, RiskFacts } from './risk';

const base: RiskFacts = { amountCents: 19700n, attempts: { cpf: 1, ip: 1, device: 1 }, identitiesOnDevice: 1, recentDeclines: 0, ipCountry: 'BR', firstPurchase: false, hasDevice: true, blockedDevice: false, blockedBin: false, hourBRT: 14 };
const cfg = DEFAULT_RISK;
const rules = (f: Partial<RiskFacts>) => scoreRules({ ...base, ...f }, cfg).map(s => s.rule);

describe('antifraude: regras', () => {
  it('compra normal não dispara nada', () => expect(scoreRules(base, cfg)).toEqual([]));
  it('velocidade por CPF, IP e aparelho acima do máximo', () => {
    expect(rules({ attempts: { cpf: 4, ip: 1, device: 1 } })).toEqual(['velocity_cpf']);
    expect(rules({ attempts: { cpf: 3, ip: 6, device: 4 } })).toEqual(['velocity_ip', 'velocity_device']);
  });
  it('vários CPFs no mesmo aparelho', () => expect(rules({ identitiesOnDevice: 3 })).toEqual(['identities_device']));
  it('IP de fora do Brasil; sem país não pontua', () => { expect(rules({ ipCountry: 'US' })).toEqual(['foreign_ip']); expect(rules({ ipCountry: undefined })).toEqual([]); });
  it('primeira compra com valor alto', () => { expect(rules({ firstPurchase: true, amountCents: 50_000n })).toEqual(['new_buyer_high_amount']); expect(rules({ firstPurchase: true, amountCents: 49_999n })).toEqual([]); });
  it('madrugada (0h–5h)', () => { expect(rules({ hourBRT: 3 })).toEqual(['night']); expect(rules({ hourBRT: 5 })).toEqual([]); });
  it('madrugada atravessando a meia-noite (22h–5h)', () => {
    const c = mergeConfig({ rules: { night: { enabled: true, points: 10, from_h: 22, to_h: 5 } } as any });
    expect(scoreRules({ ...base, hourBRT: 23 }, c).map(s => s.rule)).toEqual(['night']);
    expect(scoreRules({ ...base, hourBRT: 12 }, c)).toEqual([]);
  });
  it('sem aparelho: pontua e não conta velocidade de aparelho', () => expect(rules({ hasDevice: false, attempts: { cpf: 1, ip: 1, device: 0 } })).toEqual(['no_device']));
  it('aparelho ou BIN bloqueado somam 100', () => expect(total(scoreRules({ ...base, blockedBin: true }, cfg))).toBe(100));
  it('regra desligada não pontua', () => {
    const c = mergeConfig({ rules: { foreign_ip: { enabled: false, points: 25 } } as any });
    expect(scoreRules({ ...base, ipCountry: 'US' }, c)).toEqual([]);
  });
  it('pontuação do gateway × peso', () => {
    expect(gatewaySignal(80, cfg)?.points).toBe(40);
    expect(gatewaySignal(undefined, cfg)).toBeNull();
    expect(gatewaySignal(0, cfg)).toBeNull();
  });
});

describe('antifraude: faixas', () => {
  it('aprovar, 3DS, revisar, recusar', () => {
    expect(decide(39, cfg.bands)).toBe('approve');
    expect(decide(40, cfg.bands)).toBe('three_ds');
    expect(decide(60, cfg.bands)).toBe('review');
    expect(decide(85, cfg.bands)).toBe('decline');
  });
  it('faixas precisam crescer', () => { expect(validBands({ three_ds: 40, review: 60, decline: 85 })).toBe(true); expect(validBands({ three_ds: 60, review: 60, decline: 85 })).toBe(false); });
  it('config salva parcial herda os padrões', () => {
    const c = mergeConfig({ bands: { review: 70 } } as any);
    expect(c.bands).toEqual({ three_ds: 40, review: 70, decline: 85 });
    expect(c.rules.velocity_cpf.max).toBe(3);
  });
});

describe('reserva de segurança', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const young = { reserve_pct: 0, reserve_days: 30, created_at: new Date('2026-11-01T00:00:00Z') };
  const old = { reserve_pct: 0, reserve_days: 30, created_at: new Date('2025-01-01T00:00:00Z') };
  const on = mergeConfig({ reserve: { new_account_pct: 20, new_account_days: 45, account_age_days: 30, min_paid_orders: 20 } });
  it('desligada por padrão', () => expect(reserveFor(young, 0, cfg, now)).toBeNull());
  it('conta nova (idade ou poucas vendas)', () => {
    expect(reserveFor(young, 100, on, now)).toEqual({ pct: 20, days: 45 });
    expect(reserveFor(old, 5, on, now)).toEqual({ pct: 20, days: 45 });
    expect(reserveFor(old, 50, on, now)).toBeNull();
  });
  it('reserva própria da conta vale sempre', () => expect(reserveFor({ ...old, reserve_pct: 10, reserve_days: 60 }, 500, cfg, now)).toEqual({ pct: 10, days: 60 }));
  it('separa a reserva de cada parcela, sem perder centavos', () => {
    const paid = new Date('2026-11-11T12:00:00Z'), d1 = new Date('2026-11-12T12:00:00Z'), g = new Date('2026-11-18T12:00:00Z');
    const out = applyReserve([{ amount: 9001n, availableAt: d1 }, { amount: 1000n, availableAt: g }], 20, 30, paid);
    expect(out.reduce((s, p) => s + p.amount, 0n)).toBe(10001n);
    const late = out.filter(p => p.availableAt.getTime() === paid.getTime() + 30 * 86400000);
    expect(late.reduce((s, p) => s + p.amount, 0n)).toBe(1800n + 200n);
  });
});
