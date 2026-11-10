'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { brl, ago, methodLabel } from '@/lib/format';
import { useMe } from '@/components/session';
import { Button, Card, Skeleton, StatusBadge, CopyButton, Empty } from '@/components/ui';

export default function Inicio() {
  const { me } = useMe();
  const [s, setS] = useState<any>(null);
  const [steps, setSteps] = useState<any>(null);
  const [orders, setOrders] = useState<any[] | null>(null);
  useEffect(() => {
    get('/v1/dashboard/summary').then(setS).catch(() => setS({ error: true }));
    get('/v1/onboarding/steps').then(setSteps).catch(() => {});
    get('/v1/orders?limit=5').then(r => setOrders(r.data)).catch(() => setOrders([]));
  }, []);
  const first = me.user.name.split(' ')[0];
  const isNew = s && !s.error && s.month.count === 0 && s.today.count === 0 && (orders?.length ?? 0) === 0;
  const nextIdx = steps?.steps.findIndex((x: any) => !x.done);

  const Steps = steps && !steps.hide && (
    <Card>
      <h2 className="text-[17px] font-extrabold">Primeiros passos</h2>
      <ol className="mt-3 space-y-1">
        {steps.steps.map((st: any, i: number) => (
          <li key={st.key} className="flex min-h-[48px] items-center justify-between gap-3 border-b border-line/60 last:border-0">
            <span className={`flex items-center gap-3 ${st.done ? 'text-ink-mute line-through' : 'font-semibold'}`}>
              <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-bold ${st.done ? 'bg-ok text-white' : 'border-2 border-line text-ink-mute'}`}>{st.done ? '✓' : i + 1}</span>{st.label}
            </span>
            {!st.done && i === nextIdx && (st.key === 'share' && steps.first_link ? <CopyButton text={steps.first_link} label="Copiar link" size="sm" variant="primary" /> : st.pending_review ? <span className="text-[13px] text-ink-mute">Em análise</span> : <a href={st.href}><Button size="sm">Fazer agora</Button></a>)}
          </li>
        ))}
      </ol>
    </Card>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold">Olá, {first}</h1>
        <a href="/produtos/novo"><Button size="lg">+ Criar produto</Button></a>
      </div>
      {isNew && Steps}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-[14px] font-semibold text-ink-mute">Você vendeu este mês</p>
          {!s ? <Skeleton className="mt-2 h-8 w-32" /> : <>
            <p className="num mt-1 text-[28px] font-bold">{brl(s.month?.cents)}</p>
            <p className="text-[14px] text-ink-mute">{s.month?.count ?? 0} {s.month?.count === 1 ? 'venda' : 'vendas'}{s.month?.compare_pct != null && <> · <span className={s.month.compare_pct >= 0 ? 'text-ok' : 'text-bad'}>{Math.abs(s.month.compare_pct)}% a {s.month.compare_pct >= 0 ? 'mais' : 'menos'} que no mês passado</span></>}</p>
            {isNew && <p className="mt-1 text-[13.5px] text-ink-mute">Sua primeira venda aparece aqui.</p>}
          </>}
        </Card>
        <Card>
          <p className="text-[14px] font-semibold text-ink-mute">Você vendeu hoje</p>
          {!s ? <Skeleton className="mt-2 h-8 w-32" /> : <><p className="num mt-1 text-[28px] font-bold">{brl(s.today?.cents)}</p><p className="text-[14px] text-ink-mute">{s.today?.count ?? 0} {s.today?.count === 1 ? 'venda' : 'vendas'}</p></>}
        </Card>
        <Card className="border-2 border-action/40">
          <p className="text-[14px] font-semibold text-ink-mute">Pronto para sacar</p>
          {!s ? <Skeleton className="mt-2 h-8 w-32" /> : <>
            <p className="num mt-1 text-[28px] font-bold">{brl(s.balance?.available_cents)}</p>
            <a href="/financeiro?sacar=1"><Button size="sm" className="mt-2" disabled={!s.balance?.available_cents}>Sacar agora</Button></a>
          </>}
        </Card>
      </div>
      {s?.tip && <div className="flex gap-3 rounded-card border border-action/20 bg-action-soft/60 p-4 text-[14.5px]"><span className="font-extrabold text-action">Dica da Domma IA</span><span className="text-ink-soft">{s.tip}</span></div>}
      {!isNew && Steps}
      <Card>
        <div className="flex items-center justify-between"><h2 className="text-[17px] font-extrabold">Últimas vendas</h2><a href="/vendas" className="font-semibold text-action">Ver todas</a></div>
        {!orders ? <div className="mt-3 space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          : orders.length === 0 ? <div className="mt-3"><Empty title="Sua primeira venda aparece aqui">Divulgue seu link de venda no WhatsApp e nas redes.</Empty></div>
          : <ul className="mt-2 divide-y divide-line">{orders.map(o => (
            <li key={o.id}><a href={`/vendas/${o.id}`} className="flex min-h-[60px] items-center justify-between gap-3 py-2 hover:bg-canvas/60">
              <span className="min-w-0"><span className="block truncate font-semibold">{o.customer} comprou {o.product}</span><span className="text-[13.5px] text-ink-mute">{ago(o.created_at)} · {methodLabel(o.method)}</span></span>
              <span className="flex flex-none flex-col items-end gap-1"><span className="num font-bold">{brl(o.total_cents)}</span><StatusBadge status={o.status} label={o.status_label} /></span>
            </a></li>))}</ul>}
      </Card>
    </div>
  );
}
