'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { brl, pct } from '@/lib/format';
import { Card, Field, Select, Skeleton, Empty, Pill, Initials, Button } from '@/components/ui';
import { AffNav, Temp } from '@/components/aff-nav';

type Item = {
  product_id: string; name: string; cover_url: string | null; category_label: string | null; producer: string; price_cents: number; billing_type: string;
  commission_bps: number; max_commission_bps: number; earning_cents: number; temperature: number; sales_30d: number; conversion_pct: number | null;
  refund_pct: number; affiliates: number; guarantee_days: number; cookie_days: number; auto_approve: boolean; own: boolean; my_status: string | null;
};

/** Marketplace de afiliados: vitrine dos produtos que aceitam afiliados. */
export default function Marketplace() {
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [sort, setSort] = useState('hot'); const [page, setPage] = useState(1);
  const [d, setD] = useState<{ total: number; pages: number; items: Item[]; categories: Record<string, string> } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { setD(null); get(`/v1/marketplace?${new URLSearchParams({ q, category: cat, sort, page: String(page) })}`).then(setD); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, cat, sort, page]);
  const status = (s: string | null) => s === 'active' ? <Pill tone="ok">Você é afiliado</Pill> : s === 'pending' ? <Pill tone="warn">Aguardando aprovação</Pill> : s === 'blocked' ? <Pill tone="bad">Não aprovado</Pill> : null;
  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-extrabold">Marketplace</h1>
      <AffNav />
      <p className="text-ink-soft">Escolha produtos para divulgar e ganhe comissão em cada venda feita pelo seu link.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px_200px]">
        <Field label="Buscar" placeholder="Nome ou assunto do produto" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
        <Select label="Categoria" value={cat} onChange={e => { setCat(e.target.value); setPage(1); }}><option value="">Todas</option>{d && Object.entries(d.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select label="Ordenar por" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="hot">Mais quentes</option><option value="commission">Maior comissão</option><option value="new">Mais novos</option><option value="price">Menor preço</option></Select>
      </div>
      {!d ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-72" />)}</div>
        : d.items.length === 0 ? <Empty title="Nenhum produto encontrado">Tente outra busca ou categoria.</Empty>
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.items.map(p => (
          <a key={p.product_id} href={`/afiliado/marketplace/${p.product_id}`} className="block">
            <Card className="flex h-full flex-col p-0 transition hover:shadow-md">
              {p.cover_url ? <img src={p.cover_url} alt="" className="aspect-video w-full rounded-t-card object-cover" /> : <div className="flex aspect-video items-center justify-center rounded-t-card bg-action-soft"><Initials name={p.name} size={72} /></div>}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2"><p className="font-extrabold leading-tight">{p.name}</p><Temp v={p.temperature} /></div>
                <p className="mt-0.5 text-[13.5px] text-ink-mute">por {p.producer}{p.category_label ? ` · ${p.category_label}` : ''}</p>
                <div className="mt-3 rounded-ctl bg-ok-soft px-3 py-2"><p className="text-[12.5px] font-semibold text-ok">Você ganha até</p><p className="num text-[20px] font-extrabold text-ok">{brl(p.earning_cents)}<span className="text-[13px] font-semibold"> por venda</span></p></div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-ink-mute">Preço</dt><dd className="num text-right">{brl(p.price_cents)}{p.billing_type === 'subscription' ? '/mês' : ''}</dd>
                  <dt className="text-ink-mute">Comissão</dt><dd className="num text-right">{pct(p.commission_bps)}{p.max_commission_bps > p.commission_bps ? ` a ${pct(p.max_commission_bps)}` : ''}</dd>
                  <dt className="text-ink-mute">Conversão</dt><dd className="num text-right">{p.conversion_pct != null ? `${p.conversion_pct}%` : '—'}</dd>
                  <dt className="text-ink-mute">Cookie</dt><dd className="num text-right">{p.cookie_days} dias</dd>
                </dl>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">{p.own ? <Pill>Seu produto</Pill> : status(p.my_status) ?? <Pill tone="action">{p.auto_approve ? 'Aprovação na hora' : 'Produtor aprova'}</Pill>}{p.refund_pct >= 10 && <Pill tone="warn">Reembolso {p.refund_pct}%</Pill>}</div>
              </div>
            </Card>
          </a>))}</div>}
      {d && d.pages > 1 && <div className="flex items-center justify-center gap-3"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><span className="num text-[14px] text-ink-mute">{page} de {d.pages}</span><Button variant="secondary" size="sm" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Próxima</Button></div>}
    </div>
  );
}
