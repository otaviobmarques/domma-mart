/**
 * Teste A/B do checkout (Fase 2): sorteio da versão e estatística dos resultados.
 * Métrica "conversion": vendas pagas ÷ visitantes únicos. "revenue": receita paga por visitante
 * (melhor quando as versões têm preços diferentes).
 */
export type Arm = { visitors: number; sales: number; revenue: number; revenueSq: number };

/** Versão do visitante: b com probabilidade split_pct%. `r` em [0,1). */
export function assign(splitPct: number, r: number): 'a' | 'b' { return r * 100 < splitPct ? 'b' : 'a'; }

/** Função de distribuição da normal padrão (Abramowitz–Stegun 7.1.26, erro < 1e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Média e variância por visitante de cada métrica (visitante sem compra conta como zero). */
function moments(a: Arm, metric: 'conversion' | 'revenue') {
  const n = a.visitors;
  if (!n) return { mean: 0, varr: 0 };
  if (metric === 'conversion') { const p = Math.min(1, a.sales / n); return { mean: p, varr: p * (1 - p) }; }
  const mean = a.revenue / n;
  return { mean, varr: Math.max(0, a.revenueSq / n - mean * mean) };
}

export const MIN_VISITORS = 100; // por versão, antes de apontar vencedor
export const MIN_SALES = 10;     // somando as duas versões

/**
 * Compara B com A. `chance_b_better` = probabilidade (aproximação normal) de B ser melhor que A na métrica.
 * Só declara vencedor com amostra mínima e confiança de 95%.
 */
export function compare(a: Arm, b: Arm, metric: 'conversion' | 'revenue') {
  const ma = moments(a, metric), mb = moments(b, metric);
  const se = Math.sqrt((a.visitors ? ma.varr / a.visitors : 0) + (b.visitors ? mb.varr / b.visitors : 0));
  const diff = mb.mean - ma.mean;
  const chance = se > 0 ? normCdf(diff / se) : diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  const lift = ma.mean > 0 ? diff / ma.mean : null;
  const enough = a.visitors >= MIN_VISITORS && b.visitors >= MIN_VISITORS && a.sales + b.sales >= MIN_SALES;
  const leader: 'a' | 'b' | null = !enough ? null : chance >= 0.95 ? 'b' : chance <= 0.05 ? 'a' : null;
  return { a: ma.mean, b: mb.mean, lift, chance_b_better: Math.round(chance * 1000) / 1000, enough_data: enough, leader };
}

/** Visitantes que ainda faltam (por versão) para ter amostra mínima. */
export function missingVisitors(a: Arm, b: Arm) { return Math.max(0, MIN_VISITORS - Math.min(a.visitors, b.visitors)); }
