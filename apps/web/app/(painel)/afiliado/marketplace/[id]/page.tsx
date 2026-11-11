'use client';
import { use, useEffect, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { brl, pct } from '@/lib/format';
import { Button, Card, Textarea, Banner, Skeleton, Pill, CopyButton, Initials, Modal } from '@/components/ui';
import { AffNav, Temp } from '@/components/aff-nav';
import { Materials, RankingList } from '@/components/aff-parts';

/** Detalhe de um produto do marketplace: comissão por oferta, regras, materiais e ranking. */
export default function ProdutoMarketplace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const load = () => get(`/v1/marketplace/${id}`).then(setP).catch(() => setErr('Este produto não está mais na vitrine.'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function request() {
    setBusy(true); setMsg(null);
    try {
      const r = await post<any>('/v1/affiliate/request', { product_id: id, message: message.trim() || undefined, source: 'marketplace' });
      setOpen(false);
      setMsg({ tone: 'ok', text: r.status === 'active' ? 'Pronto! Você já é afiliado. Seus links estão abaixo.' : 'Pedido enviado. O produtor recebe agora e avisamos por e-mail quando ele decidir.' });
      load();
    } catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); }
    setBusy(false);
  }

  if (err) return <div className="space-y-4"><AffNav /><Banner tone="bad">{err} <a href="/afiliado/marketplace" className="font-semibold underline">Voltar à vitrine</a></Banner></div>;
  if (!p) return <Skeleton className="h-96 w-full" />;
  const st = p.my_affiliation?.status;
  return (
    <div className="space-y-4">
      <a href="/afiliado/marketplace" className="text-[14px] font-semibold text-action">← Marketplace</a>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <div className="flex gap-4">
              {p.cover_url ? <img src={p.cover_url} alt="" className="h-24 w-40 flex-none rounded-ctl object-cover" /> : <Initials name={p.name} size={80} />}
              <div className="min-w-0"><h1 className="text-[22px] font-extrabold leading-tight">{p.name}</h1><p className="text-ink-mute">por {p.producer}{p.category_label ? ` · ${p.category_label}` : ''}</p><div className="mt-2"><Temp v={p.temperature} /></div></div>
            </div>
            {p.description && <p className="mt-4 whitespace-pre-line text-[15px] text-ink-soft">{p.description}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-4">
              {[['Vendas (30 dias)', p.sales_30d], ['Conversão', p.conversion_pct != null ? `${p.conversion_pct}%` : '—'], ['Reembolso', `${p.refund_pct}%`], ['Afiliados', p.affiliates]].map(([l, v]) => <div key={l as string} className="rounded-ctl bg-canvas p-3"><dt className="text-[12.5px] text-ink-mute">{l}</dt><dd className="num text-[18px] font-bold">{v}</dd></div>)}
            </dl>
          </Card>
          <Card className="p-0">
            <h2 className="px-5 pt-5 font-extrabold">Ofertas e comissão</h2>
            <ul className="mt-2 divide-y divide-line">{p.offers.map((o: any) => (
              <li key={o.offer_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div><p className="font-semibold">{o.name === 'Padrão' ? p.name : o.name}</p><p className="num text-[13.5px] text-ink-mute">{brl(o.price_cents)}{o.billing_type === 'subscription' ? ' por ciclo' : ''} · comissão {pct(o.commission_bps)}</p></div>
                <div className="flex items-center gap-3"><span className="num font-bold text-ok">{brl(o.earning_cents)}</span>{o.link && <CopyButton text={o.link} size="sm" label="Copiar link" />}</div>
              </li>))}</ul>
            <p className="px-5 pb-4 pt-1 text-[13px] text-ink-mute">Ganho estimado numa venda à vista, depois da taxa. No cartão parcelado com juros, os juros não entram na comissão.</p>
          </Card>
          {p.rules && <Card><h2 className="font-extrabold">Regras de divulgação</h2><p className="mt-2 whitespace-pre-line text-[14.5px] text-ink-soft">{p.rules}</p></Card>}
          {p.materials && <Card><h2 className="font-extrabold">Materiais de divulgação</h2><Materials items={p.materials} /></Card>}
        </div>
        <div className="order-first space-y-4 lg:order-none">
          <Card className="space-y-3">
            {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
            {p.own ? <p className="text-ink-mute">Este produto é seu.</p>
              : st === 'active' ? <><Pill tone="ok">Você é afiliado</Pill><p className="text-[14px] text-ink-soft">Copie o link de cada oferta em “Ofertas e comissão”. Vendas e comissões aparecem em Minhas afiliações.</p></>
              : st === 'pending' ? <><Pill tone="warn">Aguardando aprovação</Pill><p className="text-[14px] text-ink-soft">O produtor já recebeu seu pedido.</p></>
              : st === 'blocked' ? <p className="text-[14px] text-ink-soft">O produtor não aprovou sua afiliação a este produto.</p>
              : <><p className="font-extrabold">Quer divulgar este produto?</p>
                <ul className="space-y-1 text-[14px] text-ink-soft"><li>Cookie de <b>{p.cookie_days} dias</b> ({p.attribution === 'last_click' ? 'último clique' : 'primeiro clique'})</li><li>Garantia de {p.guarantee_days} dias para o comprador</li><li>{p.auto_approve ? 'Aprovação na hora' : 'O produtor aprova cada afiliado'}</li></ul>
                <Button full size="lg" onClick={() => { setAgree(!p.rules); setOpen(true); }}>Quero me afiliar</Button></>}
          </Card>
          <Card><h2 className="font-extrabold">Ranking do mês neste produto</h2><RankingList r={p.ranking} /></Card>
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={`Afiliar-se a ${p.name}`} footer={<Button full loading={busy} disabled={!agree} onClick={request}>{p.auto_approve ? 'Afiliar agora' : 'Enviar pedido'}</Button>}>
        <div className="space-y-3">
          <Textarea label={p.auto_approve ? 'Como você vai divulgar? (opcional)' : 'Como você vai divulgar? (o produtor lê antes de aprovar)'} value={message} onChange={e => setMessage(e.target.value.slice(0, 500))} hint="Ex.: tráfego pago no Instagram, canal no YouTube com 20 mil inscritos, lista de e-mail." />
          {p.rules && <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" className="mt-1 h-4 w-4" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>Li e aceito as regras de divulgação deste produto.</span></label>}
        </div>
      </Modal>
    </div>
  );
}
