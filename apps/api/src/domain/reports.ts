/**
 * Relatórios de retenção, LTV e cancelamento (Fase 2). Meses no fuso de Brasília.
 * Coorte = mês da primeira compra paga do cliente na conta (ou do início da assinatura).
 */
const TZ = 'America/Sao_Paulo';
export const monthKey = (d: Date) => d.toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 7); // YYYY-MM
export function addMonths(key: string, n: number) { const [y, m] = key.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; }
export function monthDiff(a: string, b: string) { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); }
export function lastMonths(n: number, now = new Date()) { const cur = monthKey(now); return Array.from({ length: n }, (_, i) => addMonths(cur, i - n + 1)); }
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export type CohortCell = { cohort: string; k: number; customers: number; revenue: number };

/**
 * Matriz de coortes de clientes. `cells`: por coorte e mês k desde a primeira compra (0 = mês da 1ª),
 * quantos clientes compraram no mês e quanto pagaram. Retenção[k] = % da coorte que comprou de novo no mês k;
 * LTV[k] = receita acumulada até o mês k ÷ clientes da coorte. Meses que ainda não chegaram ficam null.
 */
export function customerCohorts(cells: CohortCell[], months: string[], now = new Date(), horizon = 12) {
  const cur = monthKey(now);
  return months.map(c => {
    const rows = cells.filter(x => x.cohort === c);
    const size = rows.find(x => x.k === 0)?.customers ?? 0;
    const maxK = Math.min(horizon - 1, monthDiff(c, cur));
    let acc = 0;
    const retention: (number | null)[] = [], ltv: (number | null)[] = [];
    for (let k = 0; k < horizon; k++) {
      if (k > maxK) { retention.push(null); ltv.push(null); continue; }
      const r = rows.find(x => x.k === k);
      acc += r?.revenue ?? 0;
      retention.push(k === 0 ? 100 : pct(r?.customers ?? 0, size));
      ltv.push(size ? Math.round(acc / size) : 0);
    }
    return { cohort: c, customers: size, retention, ltv_cents: ltv };
  });
}

export const MONTHS_PER: Record<string, number> = { month: 1, quarter: 3, semester: 6, year: 12 };
/** Valor mensal de uma assinatura (anual ÷ 12, etc.), para o MRR. */
export const monthly = (priceCents: number, interval: string | null) => Math.round(priceCents / (MONTHS_PER[interval ?? 'month'] ?? 1));

export type Sub = { created_at: Date; ended_at: Date | null; end_reason: string | null; price_cents: number; interval: string | null; status: string; cancel_requested_at: Date | null };

const activeAt = (s: Sub, t: Date) => s.created_at <= t && (!s.ended_at || s.ended_at > t);
/** Início do mês (00:00 de Brasília, UTC−3) de uma chave YYYY-MM. */
export const monthStart = (key: string) => new Date(`${key}-01T03:00:00.000Z`);

/** Série mensal: ativas no início, novas, encerradas (por motivo), churn % e MRR no fim do mês. */
export function subscriptionSeries(subs: Sub[], months: string[], now = new Date()) {
  return months.map(m => {
    const start = monthStart(m), end = new Date(Math.min(monthStart(addMonths(m, 1)).getTime(), now.getTime()));
    const atStart = subs.filter(s => activeAt(s, start));
    const ended = subs.filter(s => s.ended_at && s.ended_at > start && s.ended_at <= end);
    const endedFromStart = ended.filter(s => s.created_at <= start).length;
    const mrr = subs.filter(s => activeAt(s, end)).reduce((a, s) => a + monthly(s.price_cents, s.interval), 0);
    const by = (r: string) => ended.filter(s => s.end_reason === r).length;
    return {
      month: m, active_start: atStart.length, new: subs.filter(s => s.created_at > start && s.created_at <= end).length,
      ended: ended.length, voluntary: by('voluntary'), payment_failed: by('payment_failed'), refund: by('refund'),
      churn_pct: pct(endedFromStart, atStart.length), mrr_cents: mrr,
    };
  });
}

/** Coortes de assinantes: % ainda ativos k meses depois de assinar (k = 0..horizon-1). */
export function subscriptionCohorts(subs: Sub[], months: string[], now = new Date(), horizon = 12) {
  return months.map(c => {
    const group = subs.filter(s => monthKey(s.created_at) === c);
    const alive: (number | null)[] = [];
    for (let k = 0; k < horizon; k++) {
      const t = monthStart(addMonths(c, k + 1)); // fim do k-ésimo mês
      if (monthStart(addMonths(c, k)) > now) { alive.push(null); continue; }
      const at = t > now ? now : t;
      alive.push(pct(group.filter(s => !s.ended_at || s.ended_at > at).length, group.length));
    }
    return { cohort: c, subscribers: group.length, active_pct: alive };
  });
}

/**
 * Resumo: MRR, ativas, ticket mensal (ARPU), churn médio dos últimos 3 meses fechados,
 * vida média estimada (1 ÷ churn) e LTV do assinante (ARPU × vida média).
 */
export function subscriptionSummary(subs: Sub[], series: ReturnType<typeof subscriptionSeries>, now = new Date()) {
  const active = subs.filter(s => activeAt(s, now));
  const mrr = active.reduce((a, s) => a + monthly(s.price_cents, s.interval), 0);
  const closed = series.slice(0, -1).slice(-3).filter(m => m.active_start > 0);
  const churn = closed.length ? closed.reduce((a, m) => a + m.churn_pct, 0) / closed.length : null;
  const arpu = active.length ? Math.round(mrr / active.length) : 0;
  const lifetime = churn && churn > 0 ? Math.round((100 / churn) * 10) / 10 : null;
  return {
    mrr_cents: mrr, active: active.length, arpu_cents: arpu, churn_pct: churn == null ? null : Math.round(churn * 10) / 10,
    lifetime_months: lifetime, ltv_cents: lifetime ? Math.round(arpu * lifetime) : null,
    past_due: active.filter(s => s.status === 'past_due').length, cancel_scheduled: active.filter(s => s.cancel_requested_at).length,
  };
}
