'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { brl, ago, methodLabel, dateTime } from '@/lib/format';
import { Button, Card, Field, Select, Skeleton, StatusBadge, Empty, cx } from '@/components/ui';
import { CustomersReport, SubscriptionsReport } from '@/components/retention-reports';

const TABS = [['lista', 'Lista'], ['relatorio', 'Visão geral'], ['clientes', 'Clientes e LTV'], ['assinaturas', 'Assinaturas']] as const;
type Tab = (typeof TABS)[number][0];

export default function Vendas() {
  const [tab, setTab] = useState<Tab>('lista');
  const [f, setF] = useState({ q: '', status: '', method: '', product_id: '', from: '', to: '', affiliate: '', utm_source: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [rep, setRep] = useState<any>(null);
  const qs = () => new URLSearchParams(Object.fromEntries(Object.entries({ ...f, from: f.from ? new Date(f.from + 'T00:00:00-03:00').toISOString() : '', to: f.to ? new Date(f.to + 'T23:59:59-03:00').toISOString() : '' }).filter(([, v]) => v)));
  const load = async (more = false) => {
    const q = qs(); if (more && cursor) q.set('cursor', cursor);
    const r = await get(`/v1/orders?${q}`);
    setRows(more ? [...(rows ?? []), ...r.data] : r.data); setCursor(r.next_cursor);
  };
  useEffect(() => { get('/v1/products').then(setProducts); const a = new URLSearchParams(location.search).get('aba'); if (TABS.some(([k]) => k === a)) setTab(a as Tab); }, []);
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [f]);
  useEffect(() => { if (tab === 'relatorio') { const q = qs(); get(`/v1/reports/overview?${q}`).then(setRep); } /* eslint-disable-next-line */ }, [tab, f.from, f.to]);
  const max = rep ? Math.max(1, ...rep.by_day.map((d: any) => d.cents)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold">Vendas</h1>
        <div className="flex flex-wrap gap-1 rounded-ctl bg-white p-1 ring-1 ring-line" role="tablist">{TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('min-h-[36px] rounded-[8px] px-3 text-[14px] font-bold', tab === t ? 'bg-action text-white' : 'text-ink-soft')}>{l}</button>)}</div>
      </div>
      {(tab === 'clientes' || tab === 'assinaturas') && <div className="mt-4">{tab === 'clientes' ? <CustomersReport products={products} /> : <SubscriptionsReport products={products} />}</div>}
      {(tab === 'lista' || tab === 'relatorio') && <>
      <Card className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Buscar" placeholder="Nome, e-mail, CPF ou código" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} className="sm:col-span-2" />
        <Field label="De" type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />
        <Field label="Até" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />
        {tab === 'lista' && <>
          <Select label="Status" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">Todos</option><option value="paid">Pago</option><option value="pending">Esperando o pagamento</option><option value="refunded,refund_requested">Devolvido</option><option value="chargeback">Em análise</option><option value="expired">Não pago</option><option value="failed">Recusado</option></Select>
          <Select label="Meio" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}><option value="">Todos</option><option value="pix">Pix</option><option value="card">Cartão</option><option value="boleto">Boleto</option></Select>
          <Select label="Produto" value={f.product_id} onChange={e => setF({ ...f, product_id: e.target.value })}><option value="">Todos</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select label="Origem" value={f.affiliate} onChange={e => setF({ ...f, affiliate: e.target.value })}><option value="">Todas</option><option value="1">Afiliados</option></Select>
        </>}
      </Card>

      {tab === 'lista' ? (
        <Card className="mt-4 p-0">
          <div className="flex items-center justify-between px-5 py-3"><span className="text-[14px] text-ink-mute">{rows ? `${rows.length}${cursor ? '+' : ''} pedidos` : ''}</span><a href={`/v1/orders/export.csv?${qs()}`} className="font-semibold text-action">Exportar CSV</a></div>
          {!rows ? <div className="space-y-2 p-5">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div> : rows.length === 0 ? <div className="p-5"><Empty title="Nenhuma venda encontrada" /></div> : (
            <>
              <table className="hidden w-full text-left text-[14.5px] md:table">
                <thead className="border-y border-line bg-canvas/60 text-[13px] text-ink-mute"><tr><th className="px-5 py-2 font-semibold">Quando</th><th className="font-semibold">Comprador</th><th className="font-semibold">Produto</th><th className="font-semibold">Meio</th><th className="text-right font-semibold">Valor</th><th className="px-5 font-semibold">Status</th></tr></thead>
                <tbody className="divide-y divide-line">{rows.map(o => (
                  <tr key={o.id} className="cursor-pointer hover:bg-canvas/50" onClick={() => (location.href = `/vendas/${o.id}`)}>
                    <td className="px-5 py-3 text-ink-mute" title={dateTime(o.created_at)}>{ago(o.created_at)}</td>
                    <td><a href={`/vendas/${o.id}`} className="font-semibold">{o.customer}</a><span className="block text-[13px] text-ink-mute">{o.email}</span></td>
                    <td className="max-w-[220px] truncate">{o.product}{o.affiliate && <span className="ml-1 text-[12px] text-action">· afiliado</span>}</td>
                    <td>{methodLabel(o.method)}</td><td className="num text-right font-semibold">{brl(o.total_cents)}</td>
                    <td className="px-5"><StatusBadge status={o.status} label={o.status_label} /></td>
                  </tr>))}</tbody>
              </table>
              <ul className="divide-y divide-line md:hidden">{rows.map(o => <li key={o.id}><a href={`/vendas/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3"><span className="min-w-0"><span className="block truncate font-semibold">{o.customer} comprou {o.product}</span><span className="text-[13px] text-ink-mute">{ago(o.created_at)} · {methodLabel(o.method)}</span></span><span className="flex flex-none flex-col items-end gap-1"><span className="num font-bold">{brl(o.total_cents)}</span><StatusBadge status={o.status} label={o.status_label} /></span></a></li>)}</ul>
              {cursor && <div className="p-4 text-center"><Button variant="secondary" onClick={() => load(true)}>Carregar mais</Button></div>}
            </>
          )}
        </Card>
      ) : !rep ? <Skeleton className="mt-4 h-64 w-full" /> : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[['Faturamento bruto', brl(rep.gross_cents)], ['Você recebeu (líquido)', brl(rep.net_cents)], ['Vendas aprovadas', rep.approved], ['Ticket médio', brl(rep.avg_ticket_cents)], ['Conversão do checkout', rep.checkout_conversion_pct != null ? `${rep.checkout_conversion_pct}%` : '—'], ['Aprovação de cartão', rep.card_approval_pct != null ? `${rep.card_approval_pct}%` : '—'], ['Pix pagos / gerados', `${rep.pix.paid} / ${rep.pix.generated}`], ['Reembolsos', rep.refunds]].map(([l, v]) => <Card key={l as string}><p className="text-[13.5px] font-semibold text-ink-mute">{l}</p><p className="num mt-1 text-[22px] font-bold">{v}</p></Card>)}
          </div>
          <Card><h2 className="font-extrabold">Vendas por dia</h2>
            {rep.by_day.length === 0 ? <p className="mt-2 text-ink-mute">Sem vendas no período.</p> : <div className="mt-4 flex h-40 items-end gap-1" role="img" aria-label="Gráfico de vendas por dia">{rep.by_day.map((d: any) => <div key={d.d} className="group relative flex-1"><div className="rounded-t bg-action" style={{ height: `${Math.max(3, (d.cents / max) * 150)}px` }} /><span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-[12px] text-white group-hover:block">{d.d.slice(8, 10)}/{d.d.slice(5, 7)} · {brl(d.cents)}</span></div>)}</div>}
          </Card>
          <Card><h2 className="font-extrabold">Origem (UTM)</h2><ul className="mt-2 divide-y divide-line">{rep.by_source.map((s: any) => <li key={s.source} className="flex min-h-[44px] items-center justify-between"><span>{s.source}</span><span className="num">{s.n} · {brl(s.cents)}</span></li>)}</ul></Card>
        </div>
      )}
      </>}
    </div>
  );
}
