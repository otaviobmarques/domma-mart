'use client';
import { useEffect, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { brl, dateTime } from '@/lib/format';
import { Button, Card, Field, Select, Banner, Pill, Modal, Skeleton, cx } from '@/components/ui';

type Side = { offer_id: string; name: string; price_cents: number; checkout_url: string; visitors: number; views: number; orders: number; sales: number; refunds: number; revenue: number; conversion_pct: number; revenue_per_visitor_cents: number; avg_ticket_cents: number };
type Exp = {
  id: string; name: string; status: 'running' | 'paused' | 'ended'; winner: 'a' | 'b' | null; split_pct: number; metric: 'conversion' | 'revenue'; started_at: string; ended_at: string | null;
  a: Side; b: Side; result: { chance_b_better: number; enough_data: boolean; leader: 'a' | 'b' | null; lift_pct: number | null; missing_visitors: number };
};

const err = (e: unknown) => Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title;

/** Produto › Teste A/B: compara duas ofertas no mesmo link de venda. */
export function AbTest({ p, reload, setMsg, onPickOffer }: { p: any; reload: () => void; setMsg: (m: any) => void; onPickOffer: (id: string) => void }) {
  const [list, setList] = useState<Exp[] | null>(null);
  const active = p.offers.filter((o: any) => o.status === 'active');
  const [f, setF] = useState({ name: '', control_offer_id: active[0]?.id ?? '', variant_offer_id: active[1]?.id ?? '', split_pct: 50, metric: 'conversion' });
  const [end, setEnd] = useState<Exp | null>(null);
  const load = () => get<Exp[]>(`/v1/products/${p.id}/experiments`).then(setList);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [p.id]);

  async function dup() {
    try { const r = await post<any>(`/v1/offers/${f.control_offer_id}/duplicate`, {}); await reload(); setF({ ...f, variant_offer_id: r.id }); setMsg({ tone: 'ok', text: `“${r.name}” criada. Mude nela o que quer testar (preço, visual, oferta especial…) e volte aqui para começar.` }); onPickOffer(r.id); }
    catch (e) { setMsg({ tone: 'bad', text: err(e) }); }
  }
  async function start() {
    setMsg(null);
    try { await post(`/v1/products/${p.id}/experiments`, { ...f, name: f.name.trim() || 'Teste A/B' }); setMsg({ tone: 'ok', text: 'Teste começou. Divulgue o link da oferta A normalmente: dividimos os visitantes.' }); load(); }
    catch (e) { setMsg({ tone: 'bad', text: err(e) }); }
  }
  async function act(e: Exp, action: string, body?: any) {
    try { await post(`/v1/experiments/${e.id}/${action}`, body ?? {}); setEnd(null); load(); }
    catch (x) { setMsg({ tone: 'bad', text: err(x) }); }
  }
  const running = list?.find(e => e.status !== 'ended');

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h2 className="font-extrabold">Como funciona</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[14.5px] text-ink-soft">
          <li>Crie a versão B com <b>Duplicar oferta</b> e mude <b>uma coisa</b>: preço, parcelas, visual do checkout, oferta especial ou upsell.</li>
          <li>Comece o teste. Quem abre o link da oferta A cai em A ou B (cada pessoa vê sempre a mesma versão). Links de afiliados e cupons continuam valendo.</li>
          <li>Quando houver dados suficientes, mostramos qual vende mais. Ao encerrar com B vencedora, o link de A passa a mostrar B para todos.</li>
        </ol>
      </Card>

      {!list ? <Skeleton className="h-40" /> : running ? <Result e={running} onAct={act} onEnd={() => setEnd(running)} /> : (
        <Card className="space-y-3">
          <h2 className="font-extrabold">Novo teste</h2>
          {active.length < 2 ? <>
            <Banner tone="info">Você precisa de duas ofertas à venda. Duplique a oferta atual para criar a versão B.</Banner>
            <Button onClick={dup} disabled={!active.length}>Duplicar “{active[0]?.name ?? 'oferta'}”</Button>
          </> : <>
            <Field label="Nome do teste" value={f.name} onChange={e => setF({ ...f, name: e.target.value.slice(0, 80) })} placeholder="Ex.: Preço R$ 197 x R$ 147" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Versão A (link que você divulga)" value={f.control_offer_id} onChange={e => setF({ ...f, control_offer_id: e.target.value })}>{active.map((o: any) => <option key={o.id} value={o.id}>{o.name} — {brl(o.price_cents)}</option>)}</Select>
              <Select label="Versão B" value={f.variant_offer_id} onChange={e => setF({ ...f, variant_offer_id: e.target.value })}>{active.filter((o: any) => o.id !== f.control_offer_id).map((o: any) => <option key={o.id} value={o.id}>{o.name} — {brl(o.price_cents)}</option>)}</Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Visitantes que veem a B" value={f.split_pct} onChange={e => setF({ ...f, split_pct: Number(e.target.value) })}>{[10, 20, 30, 40, 50, 60, 70, 80, 90].map(n => <option key={n} value={n}>{n}%</option>)}</Select>
              <Select label="Quem vence" value={f.metric} onChange={e => setF({ ...f, metric: e.target.value })}><option value="conversion">Quem converte mais (vendas ÷ visitantes)</option><option value="revenue">Quem fatura mais por visitante</option></Select>
            </div>
            {f.metric === 'conversion' && active.find((o: any) => o.id === f.control_offer_id)?.price_cents !== active.find((o: any) => o.id === f.variant_offer_id)?.price_cents && <Banner tone="warn">Os preços são diferentes: “quem fatura mais por visitante” costuma ser a melhor escolha.</Banner>}
            <div className="flex flex-wrap gap-2"><Button onClick={start} disabled={!f.variant_offer_id}>Começar teste</Button><Button variant="ghost" onClick={dup}>Duplicar a versão A</Button></div>
          </>}
        </Card>
      )}

      {list && list.filter(e => e.status === 'ended').length > 0 && <Card className="p-0"><h2 className="px-5 pt-5 font-extrabold">Testes encerrados</h2>
        <ul className="mt-2 divide-y divide-line">{list.filter(e => e.status === 'ended').map(e => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[14.5px]">
            <span><b>{e.name}</b> <span className="text-ink-mute">· {dateTime(e.started_at)} a {e.ended_at ? dateTime(e.ended_at) : '—'}</span></span>
            <span className="flex items-center gap-2"><Pill tone="ok">Vencedora: {e.winner === 'b' ? `B (${e.b.name})` : `A (${e.a.name})`}</Pill><span className="num text-ink-mute">A {e.a.conversion_pct}% · B {e.b.conversion_pct}%</span></span>
          </li>))}</ul></Card>}

      <Modal open={!!end} onClose={() => setEnd(null)} title="Encerrar teste" footer={<div className="flex w-full flex-wrap gap-2"><Button variant="secondary" className="flex-1" onClick={() => act(end!, 'end', { winner: 'a' })}>Ficar com A</Button><Button className="flex-1" onClick={() => act(end!, 'end', { winner: 'b' })}>Ficar com B</Button></div>}>
        {end && <div className="space-y-2 text-[14.5px] text-ink-soft">
          {end.result.leader ? <p>Pelos dados, a versão <b>{end.result.leader.toUpperCase()}</b> vende mais.</p> : <p>Ainda <b>não há um vencedor claro</b>. Se encerrar agora, a escolha é sua.</p>}
          <p><b>Ficar com B:</b> o link da oferta A passa a mostrar a oferta B para todos (anúncios e links de afiliados continuam funcionando).</p>
          <p><b>Ficar com A:</b> tudo volta a ser como antes do teste.</p>
        </div>}
      </Modal>
    </div>
  );
}

function Result({ e, onAct, onEnd }: { e: Exp; onAct: (e: Exp, a: string) => void; onEnd: () => void }) {
  const r = e.result, chance = Math.round(r.chance_b_better * 100);
  const verdict = !r.enough_data ? { tone: 'info' as const, text: `Coletando dados: faltam cerca de ${r.missing_visitors} visitantes por versão (e pelo menos 10 vendas no total) para comparar.` }
    : r.leader === 'b' ? { tone: 'ok' as const, text: `A versão B está vencendo, com ${chance}% de confiança${r.lift_pct != null ? ` (${r.lift_pct > 0 ? '+' : ''}${r.lift_pct}%)` : ''}.` }
    : r.leader === 'a' ? { tone: 'warn' as const, text: `A versão A está vencendo, com ${100 - chance}% de confiança.` }
    : { tone: 'info' as const, text: `Empate técnico por enquanto: ${chance}% de chance de B ser melhor. Deixe rodar mais.` };
  const metricLabel = e.metric === 'revenue' ? 'Receita por visitante' : 'Conversão';
  const col = (k: 'a' | 'b') => {
    const s = e[k], win = r.leader === k;
    return (
      <div className={cx('rounded-card border-2 p-4', win ? 'border-ok bg-ok-soft/40' : 'border-line')}>
        <div className="flex items-center justify-between gap-2"><p className="font-extrabold">Versão {k.toUpperCase()}</p>{win && <Pill tone="ok">Vencendo</Pill>}</div>
        <p className="truncate text-[14px] text-ink-mute">{s.name} · {brl(s.price_cents)}</p>
        <p className="num mt-3 text-[28px] font-bold">{e.metric === 'revenue' ? brl(s.revenue_per_visitor_cents) : `${s.conversion_pct}%`}</p>
        <p className="text-[13px] text-ink-mute">{metricLabel}</p>
        <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[13.5px]">
          <dt className="text-ink-mute">Visitantes</dt><dd className="num text-right">{s.visitors}</dd>
          <dt className="text-ink-mute">Vendas pagas</dt><dd className="num text-right">{s.sales}</dd>
          <dt className="text-ink-mute">Conversão</dt><dd className="num text-right">{s.conversion_pct}%</dd>
          <dt className="text-ink-mute">Receita</dt><dd className="num text-right">{brl(s.revenue)}</dd>
          <dt className="text-ink-mute">Por visitante</dt><dd className="num text-right">{brl(s.revenue_per_visitor_cents)}</dd>
          <dt className="text-ink-mute">Ticket médio</dt><dd className="num text-right">{brl(s.avg_ticket_cents)}</dd>
          <dt className="text-ink-mute">Reembolsos</dt><dd className="num text-right">{s.refunds}</dd>
        </dl>
        <a href={s.checkout_url} target="_blank" className="mt-2 inline-block text-[13.5px] font-semibold text-action">Ver esta versão ↗</a>
      </div>
    );
  };
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-extrabold">{e.name}</h2><p className="text-[13.5px] text-ink-mute">Desde {dateTime(e.started_at)} · {100 - e.split_pct}% veem A, {e.split_pct}% veem B · decide por {metricLabel.toLowerCase()}</p></div>
        {e.status === 'paused' ? <Pill tone="warn">Pausado: todos veem A</Pill> : <Pill tone="action">Rodando</Pill>}
      </div>
      <Banner tone={verdict.tone}>{verdict.text}</Banner>
      <div className="grid gap-3 sm:grid-cols-2">{col('a')}{col('b')}</div>
      {r.enough_data && <div><div className="flex justify-between text-[13px] text-ink-mute"><span>A melhor</span><span>Chance de B ser melhor: <b className="num">{chance}%</b></span><span>B melhor</span></div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-line"><div className={cx('h-full', chance >= 95 ? 'bg-ok' : chance <= 5 ? 'bg-warn' : 'bg-action')} style={{ width: `${chance}%` }} /></div></div>}
      <div className="flex flex-wrap gap-2">
        {e.status === 'running' ? <Button variant="secondary" onClick={() => onAct(e, 'pause')}>Pausar</Button> : <Button variant="secondary" onClick={() => onAct(e, 'resume')}>Retomar</Button>}
        <Button onClick={onEnd}>Encerrar e escolher a vencedora</Button>
      </div>
      <p className="text-[13px] text-ink-mute">Conta visitantes únicos do link da oferta A. Vendas reembolsadas ou contestadas não contam. Evite mudar as ofertas durante o teste.</p>
    </Card>
  );
}
