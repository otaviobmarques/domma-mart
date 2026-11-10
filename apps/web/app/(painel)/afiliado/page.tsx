'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { brl, pct } from '@/lib/format';
import { Card, Skeleton, Empty, CopyButton, Pill, Button } from '@/components/ui';

/** Painel do afiliado (19.10). */
export default function PainelAfiliado() {
  const [s, setS] = useState<any>(null);
  const [links, setLinks] = useState<any[] | null>(null);
  useEffect(() => { get('/v1/affiliate/summary').then(setS); get('/v1/affiliate/links').then(setLinks); }, []);
  const main = links?.find(l => l.status === 'active');
  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-extrabold">Painel do afiliado</h1>
      <nav className="flex flex-wrap gap-1 text-[14px] font-semibold"><span className="rounded-full bg-action px-3 py-1 text-white">Minhas afiliações</span><span className="rounded-full px-3 py-1 text-ink-mute" title="Em breve">Marketplace</span><a href="#produtos" className="rounded-full px-3 py-1 text-ink-soft">Comissões</a><span className="rounded-full px-3 py-1 text-ink-mute">Materiais</span><a href="/financeiro" className="rounded-full px-3 py-1 text-ink-soft">Saques</a></nav>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['Cliques (30 dias)', s?.clicks_30d], ['Vendas', s?.sales], ['Comissões a liberar', s && brl(s.incoming_cents)], ['Disponível para saque', s && brl(s.available_cents)]].map(([l, v]) => <Card key={l as string}><p className="text-[13.5px] font-semibold text-ink-mute">{l}</p>{s ? <p className="num mt-1 text-[24px] font-bold">{v}</p> : <Skeleton className="mt-2 h-7 w-20" />}</Card>)}
      </div>
      {main && <Card className="border-2 border-action/40"><p className="font-extrabold">Seu link</p><div className="mt-2 flex flex-wrap items-center gap-2"><p className="num min-w-0 flex-1 break-all rounded-ctl bg-canvas px-3 py-2.5 text-[14px]">{main.link}</p><CopyButton text={main.link} variant="primary" /></div><p className="mt-2 text-[14px] text-ink-mute">Comissão {pct(main.commission_bps)} · cookie {main.cookie_days} dias · {main.attribution === 'last_click' ? 'último clique' : 'primeiro clique'}</p></Card>}
      <Card id="produtos" className="p-0">
        <h2 className="px-5 pt-5 font-extrabold">Produtos que você divulga</h2>
        {!links ? <Skeleton className="m-5 h-24" /> : links.length === 0 ? <div className="p-5"><Empty title="Você ainda não é afiliado de nenhum produto">Peça ao produtor o link de convite de afiliação.</Empty></div> : (
          <div className="overflow-x-auto"><table className="mt-3 w-full min-w-[640px] text-left text-[14.5px]">
            <thead className="border-y border-line bg-canvas/60 text-[13px] text-ink-mute"><tr><th className="px-5 py-2 font-semibold">Produto</th><th className="font-semibold">Produtor</th><th className="text-right font-semibold">Cliques</th><th className="text-right font-semibold">Vendas</th><th className="text-right font-semibold">Conversão</th><th className="text-right font-semibold">Comissões</th><th className="px-5 font-semibold">Link</th></tr></thead>
            <tbody className="divide-y divide-line">{links.map(l => (
              <tr key={l.id}><td className="px-5 py-3 font-semibold">{l.product} {l.status !== 'active' && <Pill tone={l.status === 'pending' ? 'warn' : 'bad'}>{l.status === 'pending' ? 'Aguardando aprovação' : 'Bloqueado'}</Pill>}</td><td>{l.producer}</td><td className="num text-right">{l.clicks}</td><td className="num text-right">{l.sales}</td><td className="num text-right">{l.conversion_pct}%</td><td className="num text-right font-semibold">{brl(l.commissions_cents)}</td><td className="px-5">{l.status === 'active' && l.link && <CopyButton text={l.link} size="sm" />}</td></tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}
