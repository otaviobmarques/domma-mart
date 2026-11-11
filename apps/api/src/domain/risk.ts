/**
 * Antifraude com regras e pontuação (seção 10, RN-60, Fase 2).
 * Cada regra que dispara soma pontos; a soma decide a faixa: aprovar, 3-D Secure, revisar ou recusar.
 * Funções puras: os números (tentativas, CPFs no aparelho...) são levantados pelo RiskService.
 */

export type Decision = 'approve' | 'three_ds' | 'review' | 'decline';
export type Signal = { rule: RuleKey; points: number; detail: string };

export const RULE_KEYS = [
  'blocklist_device', 'blocklist_bin', 'velocity_cpf', 'velocity_ip', 'velocity_device', 'identities_device',
  'recent_declines', 'foreign_ip', 'new_buyer_high_amount', 'night', 'no_device', 'gateway_score',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

export type RuleCfg = { enabled: boolean; points: number; max?: number; window_min?: number; amount_cents?: number; from_h?: number; to_h?: number; weight?: number };
export type RiskConfig = {
  bands: { three_ds: number; review: number; decline: number };
  rules: Record<RuleKey, RuleCfg>;
  /** Reserva automática para contas novas (parte do valor fica "Chegando" por mais tempo). */
  reserve: { new_account_pct: number; new_account_days: number; account_age_days: number; min_paid_orders: number };
  /** RN-55: limites de chargeback do produtor (% dos pedidos pagos em 30 dias). */
  producer: { alert_pct: number; review_pct: number; pause_pct: number; min_orders: number };
  /** Vitrine de afiliados: produto com reembolso ou chargeback alto (30 dias) sai da vitrine. */
  marketplace: { refund_pct: number; chargeback_pct: number; min_orders: number };
};

/** Nome e explicação de cada regra, para o back-office. */
export const RULE_INFO: Record<RuleKey, { name: string; help: string }> = {
  blocklist_device: { name: 'Aparelho bloqueado', help: 'O aparelho está na lista de bloqueio.' },
  blocklist_bin: { name: 'BIN bloqueado', help: 'Os 6 primeiros números do cartão estão na lista de bloqueio.' },
  velocity_cpf: { name: 'Muitas tentativas no CPF', help: 'Mais de “máx.” tentativas de cartão com o mesmo CPF na janela.' },
  velocity_ip: { name: 'Muitas tentativas no IP', help: 'Mais de “máx.” tentativas de cartão do mesmo IP na janela.' },
  velocity_device: { name: 'Muitas tentativas no aparelho', help: 'Mais de “máx.” tentativas de cartão do mesmo aparelho na janela.' },
  identities_device: { name: 'Vários CPFs no mesmo aparelho', help: 'Mais de “máx.” CPFs diferentes compraram do mesmo aparelho ou IP na janela.' },
  recent_declines: { name: 'Recusas recentes', help: 'Pelo menos “máx.” cartões recusados para este CPF ou IP na janela.' },
  foreign_ip: { name: 'IP fora do Brasil', help: 'A compra vem de um IP de outro país.' },
  new_buyer_high_amount: { name: 'Comprador novo, valor alto', help: 'Primeira compra deste e-mail com valor a partir do limite.' },
  night: { name: 'Madrugada', help: 'Compra entre as horas indicadas (horário de Brasília).' },
  no_device: { name: 'Sem identificação do aparelho', help: 'A compra não veio do checkout no navegador (ex.: robô).' },
  gateway_score: { name: 'Pontuação do gateway', help: 'Soma a pontuação de risco do gateway (0–100) multiplicada pelo peso.' },
};

export const DEFAULT_RISK: RiskConfig = {
  bands: { three_ds: 40, review: 60, decline: 85 },
  rules: {
    blocklist_device: { enabled: true, points: 100 },
    blocklist_bin: { enabled: true, points: 100 },
    velocity_cpf: { enabled: true, points: 25, max: 3, window_min: 60 },
    velocity_ip: { enabled: true, points: 20, max: 5, window_min: 60 },
    velocity_device: { enabled: true, points: 20, max: 3, window_min: 60 },
    identities_device: { enabled: true, points: 35, max: 2, window_min: 1440 },
    recent_declines: { enabled: true, points: 20, max: 2, window_min: 60 },
    foreign_ip: { enabled: true, points: 25 },
    new_buyer_high_amount: { enabled: true, points: 15, amount_cents: 50_000 },
    night: { enabled: true, points: 10, from_h: 0, to_h: 5 },
    no_device: { enabled: true, points: 10 },
    gateway_score: { enabled: true, points: 0, weight: 0.5 },
  },
  reserve: { new_account_pct: 0, new_account_days: 30, account_age_days: 30, min_paid_orders: 20 },
  producer: { alert_pct: 1, review_pct: 1.5, pause_pct: 2, min_orders: 20 },
  marketplace: { refund_pct: 15, chargeback_pct: 1.5, min_orders: 20 },
};

/** Junta a configuração salva com os padrões (chaves novas ganham o valor padrão). */
export function mergeConfig(saved: Partial<RiskConfig> | null | undefined): RiskConfig {
  const s = saved ?? {};
  const rules = { ...DEFAULT_RISK.rules } as Record<RuleKey, RuleCfg>;
  for (const k of RULE_KEYS) rules[k] = { ...DEFAULT_RISK.rules[k], ...((s.rules as any)?.[k] ?? {}) };
  return { bands: { ...DEFAULT_RISK.bands, ...(s.bands ?? {}) }, rules, reserve: { ...DEFAULT_RISK.reserve, ...(s.reserve ?? {}) }, producer: { ...DEFAULT_RISK.producer, ...(s.producer ?? {}) }, marketplace: { ...DEFAULT_RISK.marketplace, ...(s.marketplace ?? {}) } };
}

/** Faixas precisam ser crescentes (3DS < revisão < recusa). */
export function validBands(b: RiskConfig['bands']) { return b.three_ds > 0 && b.three_ds < b.review && b.review < b.decline && b.decline <= 300; }

/** O que o RiskService mede antes da cobrança. */
export type RiskFacts = {
  amountCents: bigint;
  attempts: { cpf: number; ip: number; device: number }; // já contando esta tentativa
  identitiesOnDevice: number; // CPFs distintos no aparelho/IP na janela (incluindo este)
  recentDeclines: number;
  ipCountry?: string;
  firstPurchase: boolean;
  hasDevice: boolean;
  blockedDevice: boolean;
  blockedBin: boolean;
  hourBRT: number;
};

export function scoreRules(f: RiskFacts, cfg: RiskConfig): Signal[] {
  const r = cfg.rules, out: Signal[] = [];
  const add = (k: RuleKey, cond: boolean, detail: string) => { if (r[k].enabled && cond && r[k].points > 0) out.push({ rule: k, points: r[k].points, detail }); };
  add('blocklist_device', f.blockedDevice, 'aparelho na lista de bloqueio');
  add('blocklist_bin', f.blockedBin, 'BIN na lista de bloqueio');
  add('velocity_cpf', f.attempts.cpf > (r.velocity_cpf.max ?? 3), `${f.attempts.cpf} tentativas no CPF`);
  add('velocity_ip', f.attempts.ip > (r.velocity_ip.max ?? 5), `${f.attempts.ip} tentativas no IP`);
  add('velocity_device', f.hasDevice && f.attempts.device > (r.velocity_device.max ?? 3), `${f.attempts.device} tentativas no aparelho`);
  add('identities_device', f.identitiesOnDevice > (r.identities_device.max ?? 2), `${f.identitiesOnDevice} CPFs no mesmo aparelho/IP`);
  add('recent_declines', f.recentDeclines >= (r.recent_declines.max ?? 2), `${f.recentDeclines} recusas recentes`);
  add('foreign_ip', !!f.ipCountry && f.ipCountry !== 'BR', `IP em ${f.ipCountry}`);
  add('new_buyer_high_amount', f.firstPurchase && f.amountCents >= BigInt(r.new_buyer_high_amount.amount_cents ?? 50_000), 'primeira compra com valor alto');
  const from = r.night.from_h ?? 0, to = r.night.to_h ?? 5;
  add('night', from <= to ? f.hourBRT >= from && f.hourBRT < to : f.hourBRT >= from || f.hourBRT < to, `compra às ${f.hourBRT}h`);
  add('no_device', !f.hasDevice, 'sem identificação do aparelho');
  return out;
}

/** Pontos da pontuação do gateway (depois da cobrança). */
export function gatewaySignal(gatewayScore: number | undefined, cfg: RiskConfig): Signal | null {
  const r = cfg.rules.gateway_score;
  if (!r.enabled || gatewayScore == null) return null;
  const pts = Math.round(Math.max(0, Math.min(100, gatewayScore)) * (r.weight ?? 0.5));
  return pts > 0 ? { rule: 'gateway_score', points: pts, detail: `gateway ${gatewayScore}/100` } : null;
}

export const total = (s: Signal[]) => s.reduce((a, x) => a + x.points, 0);

export function decide(score: number, b: RiskConfig['bands']): Decision {
  if (score >= b.decline) return 'decline';
  if (score >= b.review) return 'review';
  if (score >= b.three_ds) return 'three_ds';
  return 'approve';
}

/** Hora em Brasília (0–23). */
export function hourBRT(d = new Date()) { return Number(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })) % 24; }

/**
 * Reserva de segurança: quanto do crédito do produtor segura por mais tempo.
 * Conta nova = criada há menos de N dias OU com menos de M vendas pagas.
 */
export function reserveFor(ws: { reserve_pct: number; reserve_days: number; created_at: Date }, paidOrders: number, cfg: RiskConfig, now = new Date()) {
  if (ws.reserve_pct > 0) return { pct: ws.reserve_pct, days: ws.reserve_days };
  const r = cfg.reserve;
  const young = now.getTime() - ws.created_at.getTime() < r.account_age_days * 86400000 || paidOrders < r.min_paid_orders;
  return r.new_account_pct > 0 && young ? { pct: r.new_account_pct, days: r.new_account_days } : null;
}

/** Aplica a reserva: pct% de cada parcela só fica disponível depois de `days` dias do pagamento (ou na data original, se for depois). */
export function applyReserve(parts: { amount: bigint; availableAt: Date }[], pct: number, days: number, paidAt: Date) {
  if (pct <= 0) return parts;
  const until = new Date(paidAt.getTime() + days * 86400000);
  const out: { amount: bigint; availableAt: Date }[] = [];
  for (const p of parts) {
    const r = (p.amount * BigInt(Math.min(100, pct))) / 100n;
    if (p.amount - r > 0n) out.push({ amount: p.amount - r, availableAt: p.availableAt });
    if (r > 0n) out.push({ amount: r, availableAt: p.availableAt > until ? p.availableAt : until });
  }
  return out;
}

/** Produto deve sair da vitrine? (só com volume mínimo de vendas no período) */
export function delistReason(r: { sales: number; refunds: number; chargebacks: number }, m: RiskConfig['marketplace']): string | null {
  if (r.sales < m.min_orders) return null;
  const refund = (r.refunds / r.sales) * 100, cb = (r.chargebacks / r.sales) * 100;
  if (cb >= m.chargeback_pct) return `chargeback de ${cb.toFixed(1)}% nos últimos 30 dias (limite ${m.chargeback_pct}%)`;
  if (refund >= m.refund_pct) return `reembolso de ${refund.toFixed(1)}% nos últimos 30 dias (limite ${m.refund_pct}%)`;
  return null;
}
