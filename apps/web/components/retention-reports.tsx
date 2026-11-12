'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { brl } from '@/lib/format';
import { Card, Select, Skeleton, Banner, cx } from '@/components/ui';

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthLabel = (k: string) => { const [y, m] = k.split('-'); return `${MES[Number(m) - 1]}/${y.slice(2)}`; };

/** Escala sequencial de uma cor só (lilás claro → roxo da marca), para o mapa de calor. */
function seq(t: number) {
  const a = [0xec, 0xe8, 0xff], b = [0x3a, 0x24, 0xb0], x = Math.max(0, Math.min(1, t));
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * x)).join(',')})`;
}

function Filters({ products, product, setProduct, months, setMonths, csv }: any) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select label="Produto" value={product} onChange={e => setProduct(e.target.value)} className="min-w-[220px]"><option value="">Todos os produtos</option>{products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Select label="Período" value={months} onChange={e => setMonths(Number(e.target.value))}><option value={6}>Últimos 6 meses</option><option value={12}>Últimos 12 meses</option><option value={24}>Últimos 24 meses</option></Select>
      <a href={csv} className="inline-flex min-h-[44px] items-center rounded-ctl border border-line bg-white px-4 text-[14px] font-bold text-action">Exportar CSV</a>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return <Card><p className="text-[13.5px] font-semibold text-ink-mute">{label}</p><p className="num mt-1 text-[26px] font-bold leading-tight">{value}</p>{hint && <p className="mt-1 text-[13px] text-ink-mute">{hint}</p>}</Card>;
}

/** Mapa de calor de coortes: linhas = mês da primeira compra; colunas = meses depois. */
function CohortGrid({ rows, mode, unit }: { rows: { cohort: string; size: number; values: (number | null)[] }[]; mode: 'pct' | 'money'; unit: string }) {
  const [tip, setTip] = useState<string | null>(null);
  const max = Math.max(1, ...rows.flatMap(r => r.values.slice(1).filter((v): v is number => v != null)));
  const cols = rows[0]?.values.length ?? 0;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-[13px]">
          <thead><tr className="text-ink-mute"><th className="px-2 py-1 text-left font-semibold">Coorte</th><th className="px-2 text-right font-semibold">{unit}</th>{Array.from({ length: cols }, (_, k) => <th key={k} className="px-1 font-semibold">{k === 0 ? 'Mês 0' : `+${k}`}</th>)}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.cohort}>
              <td className="whitespace-nowrap px-2 py-1 font-semibold">{monthLabel(r.cohort)}</td>
              <td className="num px-2 text-right text-ink-soft">{r.size}</td>
              {r.values.map((v, k) => {
                if (v == null) return <td key={k} className="rounded-[4px] bg-canvas/50" />;
                const t = k === 0 && mode === 'pct' ? 1 : v / max;
                const label = mode === 'pct' ? `${v}%` : brl(v);
                return <td key={k} tabIndex={0} onMouseEnter={() => setTip(`${monthLabel(r.cohort)} · ${k === 0 ? 'mês da 1ª compra' : `${k} ${k === 1 ? 'mês' : 'meses'} depois`}: ${mode === 'pct' ? `${v}% dos ${r.size} compraram de novo` : `${label} por cliente (acumulado)`}`)} onFocus={() => setTip(`${monthLabel(r.cohort)} +${k}: ${label}`)} onMouseLeave={() => setTip(null)}
                  className={cx('num h-8 min-w-[52px] rounded-[4px] px-1 text-center outline-none focus:ring-2 focus:ring-ink', r.size === 0 && 'opacity-40', t > 0.55 ? 'text-white' : 'text-ink')} style={{ background: r.size ? seq(t) : undefined }}>{r.size ? label : '—'}</td>;
              })}
            </tr>))}</tbody>
        </table>
      </div>
      <p className="mt-2 min-h-[20px] text-[13px] text-ink-soft" aria-live="polite">{tip ?? 'Passe o mouse numa célula para ver o detalhe.'}</p>
    </div>
  );
}

function Bars({ data, fmt, title, empty }: { data: { label: string; value: number }[]; fmt: (v: number) => string; title: string; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map(d => d.value), 0);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2"><h3 className="font-extrabold">{title}</h3><p className="num text-[13px] text-ink-mute">{hover != null ? `${data[hover].label}: ${fmt(data[hover].value)}` : data.length ? `${data[data.length - 1].label}: ${fmt(data[data.length - 1].value)}` : ''}</p></div>
      {max === 0 ? <p className="mt-6 text-[14px] text-ink-mute">{empty ?? 'Sem dados no período.'}</p> : (
        <div className="mt-4 flex h-40 items-end gap-[2px] border-b border-line" role="img" aria-label={`${title}: ${data.map(d => `${d.label} ${fmt(d.value)}`).join(', ')}`}>
          {data.map((d, i) => (
            <div key={d.label} className="flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className={cx('rounded-t-[4px] transition-colors', hover === i ? 'bg-action-ink' : 'bg-action')} style={{ height: `${Math.max(d.value ? 2 : 0, (d.value / max) * 100)}%` }} />
            </div>))}
        </div>)}
      <div className="mt-1 flex gap-[2px] text-[11px] text-ink-mute">{data.map((d, i) => <span key={d.label} className="flex-1 text-center">{data.length <= 12 || i % 2 === 0 ? d.label.split('/')[0] : ''}</span>)}</div>
    </Card>
  );
}

/** Vendas › Clientes e LTV: coortes de recompra, LTV acumulado, canal e produto de entrada. */
export function CustomersReport({ products }: { products: any[] }) {
  const [product, setProduct] = useState(''); const [months, setMonths] = useState(12);
  const [mode, setMode] = useState<'retencao' | 'ltv'>('retencao');
  const [d, setD] = useState<any>(null);
  const q = new URLSearchParams({ months: String(months), ...(product ? { product_id: product } : {}) }).toString();
  useEffect(() => { setD(null); get(`/v1/reports/customers?${q}`).then(setD); }, [q]);
  return (
    <div className="space-y-4">
      <Filters products={products} product={product} setProduct={setProduct} months={months} setMonths={setMonths} csv={`/v1/reports/customers.csv?${q}`} />
      {!d ? <Skeleton className="h-72 w-full" /> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="LTV médio por cliente" value={brl(d.summary.ltv_cents)} hint="Tudo o que cada cliente já pagou, em média" />
          <Tile label="Clientes que voltaram a comprar" value={`${d.summary.repeat_pct}%`} hint={`${d.summary.repeat_customers} de ${d.summary.customers} clientes`} />
          <Tile label="Compras por cliente" value={d.summary.orders_per_customer.toLocaleString('pt-BR')} />
          <Tile label="Tempo até a 2ª compra" value={d.summary.median_days_to_second == null ? '—' : `${d.summary.median_days_to_second} dias`} hint="Mediana, de quem voltou" />
        </div>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-extrabold">{mode === 'retencao' ? 'Retenção por coorte' : 'LTV acumulado por coorte'}</h3>
              <p className="text-[13.5px] text-ink-mute">{mode === 'retencao' ? 'Cada linha são os clientes da primeira compra naquele mês; as colunas mostram quantos % compraram de novo em cada mês seguinte.' : 'Quanto cada cliente da coorte já pagou, em média, somando os meses (inclui renovações de assinatura).'}</p></div>
            <div className="flex gap-1 rounded-ctl bg-canvas p-1">{(['retencao', 'ltv'] as const).map(m => <button key={m} onClick={() => setMode(m)} className={cx('min-h-[34px] rounded-[8px] px-3 text-[13.5px] font-bold', mode === m ? 'bg-white text-action shadow-sm' : 'text-ink-soft')}>{m === 'retencao' ? 'Retenção' : 'LTV'}</button>)}</div>
          </div>
          {d.summary.customers === 0 ? <Banner tone="info" className="mt-3">Ainda não há vendas pagas no período.</Banner> :
            <div className="mt-3"><CohortGrid unit="Clientes" mode={mode === 'retencao' ? 'pct' : 'money'} rows={d.cohorts.map((c: any) => ({ cohort: c.cohort, size: c.customers, values: mode === 'retencao' ? c.retention : c.ltv_cents }))} /></div>}
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          {[['by_source', 'Por canal da primeira compra', 'Origem (utm_source)'], ['by_product', 'Por produto de entrada', 'Primeiro produto comprado']].map(([k, t, col]) => (
            <Card key={k} className="p-0"><h3 className="px-5 pt-5 font-extrabold">{t}</h3><p className="px-5 text-[13.5px] text-ink-mute">Quem traz clientes que gastam mais ao longo do tempo.</p>
              {d[k].length === 0 ? <p className="p-5 text-ink-mute">Sem dados.</p> : <table className="mt-2 w-full text-[14px]"><thead className="border-y border-line bg-canvas/60 text-[12.5px] text-ink-mute"><tr><th className="px-5 py-2 text-left">{col}</th><th className="text-right">Clientes</th><th className="text-right">Voltaram</th><th className="px-5 text-right">LTV</th></tr></thead>
                <tbody className="divide-y divide-line">{d[k].map((r: any) => <tr key={r.key}><td className="max-w-[200px] truncate px-5 py-2">{r.key}</td><td className="num text-right">{r.customers}</td><td className="num text-right">{r.repeat_pct}%</td><td className="num px-5 text-right font-semibold">{brl(r.ltv_cents)}</td></tr>)}</tbody></table>}
            </Card>))}
        </div>
      </>}
    </div>
  );
}

/** Vendas › Assinaturas: MRR, churn por mês e motivo, coortes de assinantes, LTV do assinante. */
export function SubscriptionsReport({ products }: { products: any[] }) {
  const subsProducts = products.filter(p => p.type === 'subscription');
  const [product, setProduct] = useState(''); const [months, setMonths] = useState(12);
  const [d, setD] = useState<any>(null);
  const q = new URLSearchParams({ months: String(months), ...(product ? { product_id: product } : {}) }).toString();
  useEffect(() => { setD(null); get(`/v1/reports/subscriptions?${q}`).then(setD); }, [q]);
  if (d && d.total === 0 && !product) return <Banner tone="info">Você ainda não tem assinaturas. Crie um produto do tipo assinatura para ver MRR, cancelamentos e retenção de assinantes aqui.</Banner>;
  const s = d?.summary;
  return (
    <div className="space-y-4">
      <Filters products={subsProducts} product={product} setProduct={setProduct} months={months} setMonths={setMonths} csv={`/v1/reports/subscriptions.csv?${q}`} />
      {!d ? <Skeleton className="h-72 w-full" /> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Receita recorrente mensal (MRR)" value={brl(s.mrr_cents)} hint={`${s.active} assinaturas ativas · ${brl(s.arpu_cents)} por assinante`} />
          <Tile label="Cancelamento mensal (churn)" value={s.churn_pct == null ? '—' : `${s.churn_pct.toLocaleString('pt-BR')}%`} hint="Média dos últimos 3 meses fechados" />
          <Tile label="Vida média do assinante" value={s.lifetime_months == null ? '—' : `${s.lifetime_months.toLocaleString('pt-BR')} meses`} hint="Estimada: 1 ÷ churn" />
          <Tile label="LTV do assinante" value={s.ltv_cents == null ? '—' : brl(s.ltv_cents)} hint="Ticket mensal × vida média" />
        </div>
        {(s.past_due > 0 || s.cancel_scheduled > 0) && <Banner tone="warn">{s.past_due > 0 && <><b className="num">{s.past_due}</b> com pagamento atrasado (tentando cobrar de novo). </>}{s.cancel_scheduled > 0 && <><b className="num">{s.cancel_scheduled}</b> pediram para cancelar e terminam no fim do período pago.</>}</Banner>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Bars title="MRR no fim de cada mês" data={d.series.map((m: any) => ({ label: monthLabel(m.month), value: m.mrr_cents }))} fmt={brl} />
          <Bars title="Cancelamento (churn) por mês" data={d.series.map((m: any) => ({ label: monthLabel(m.month), value: m.churn_pct }))} fmt={v => `${v.toLocaleString('pt-BR')}%`} empty="Nenhum cancelamento no período." />
        </div>
        <Card className="p-0"><h3 className="px-5 pt-5 font-extrabold">Mês a mês</h3>
          <div className="overflow-x-auto"><table className="mt-2 w-full min-w-[640px] text-[14px]"><thead className="border-y border-line bg-canvas/60 text-[12.5px] text-ink-mute"><tr><th className="px-5 py-2 text-left">Mês</th><th className="text-right">Ativas no início</th><th className="text-right">Novas</th><th className="text-right">Cancelaram</th><th className="text-right">Falha no pagamento</th><th className="text-right">Reembolso</th><th className="text-right">Churn</th><th className="px-5 text-right">MRR</th></tr></thead>
            <tbody className="divide-y divide-line">{[...d.series].reverse().map((m: any) => <tr key={m.month}><td className="px-5 py-2 font-semibold">{monthLabel(m.month)}</td><td className="num text-right">{m.active_start}</td><td className="num text-right">{m.new}</td><td className="num text-right">{m.voluntary}</td><td className="num text-right">{m.payment_failed}</td><td className="num text-right">{m.refund}</td><td className="num text-right">{m.churn_pct}%</td><td className="num px-5 text-right font-semibold">{brl(m.mrr_cents)}</td></tr>)}</tbody></table></div>
        </Card>
        <Card><h3 className="font-extrabold">Retenção de assinantes por coorte</h3><p className="text-[13.5px] text-ink-mute">% dos que assinaram em cada mês que continuam ativos depois de 1, 2, 3… meses.</p>
          <div className="mt-3"><CohortGrid unit="Assinantes" mode="pct" rows={d.cohorts.map((c: any) => ({ cohort: c.cohort, size: c.subscribers, values: c.active_pct }))} /></div></Card>
      </>}
    </div>
  );
}
