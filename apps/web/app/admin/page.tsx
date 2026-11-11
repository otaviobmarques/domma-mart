'use client';
import { useEffect, useState } from 'react';
import { get, post, api, ApiError } from '@/lib/api';
import { brl, dateTime, shortDate, ago, maskMoney, moneyToCents } from '@/lib/format';
import { Button, Card, Field, Textarea, Select, Skeleton, Banner, Pill, StatusBadge, Modal, cx } from '@/components/ui';
import { Antifraude } from '@/components/admin-fraud';

export default function Admin() {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => setV(new URLSearchParams(location.search).get('v') ?? ''), []);
  if (v === null) return null;
  return ({ kyc: <Kyc />, moderacao: <Moderacao />, disputas: <Disputas />, risco: <Antifraude />, contas: <Contas />, pedidos: <Pedidos />, conciliacao: <Conciliacao />, ajustes: <Ajustes />, privacidade: <Privacidade />, auditoria: <Auditoria /> } as Record<string, React.ReactNode>)[v] ?? <Overview />;
}

function H({ children }: { children: React.ReactNode }) { return <h1 className="mb-4 text-[24px] font-extrabold">{children}</h1>; }

function Overview() {
  const [o, setO] = useState<any>(null);
  useEffect(() => { get('/v1/admin/overview').then(setO); }, []);
  if (!o) return <Skeleton className="h-40 w-full" />;
  return (<><H>Visão geral</H>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[['KYC pendentes', o.pending.kyc, '/admin?v=kyc'], ['Produtos em análise', o.pending.moderation, '/admin?v=moderacao'], ['Contestações abertas', o.pending.disputes, '/admin?v=disputas'], ['Webhooks parados', o.pending.failed_webhooks, null], ['Antifraude: revisões e alertas', (o.pending.fraud_reviews ?? 0) + (o.pending.risk_alerts ?? 0), '/admin?v=risco']].map(([l, n, h]) => <a key={l as string} href={(h as string) ?? '#'}><Card><p className="text-[13.5px] font-semibold text-ink-mute">{l}</p><p className={cx('num mt-1 text-[28px] font-bold', Number(n) > 0 && l === 'Webhooks parados' && 'text-bad')}>{n}</p></Card></a>)}
      <Card><p className="text-[13.5px] font-semibold text-ink-mute">Contas</p><p className="num mt-1 text-[28px] font-bold">{o.accounts}</p></Card>
      <Card><p className="text-[13.5px] font-semibold text-ink-mute">GMV 30 dias</p><p className="num mt-1 text-[22px] font-bold">{brl(o.gmv_30d_cents)}</p><p className="text-[13px] text-ink-mute">{o.orders_30d} pedidos</p></Card>
      <Card><p className="text-[13.5px] font-semibold text-ink-mute">Receita da plataforma</p><p className="num mt-1 text-[22px] font-bold">{brl(o.platform_revenue_cents)}</p></Card>
    </div></>);
}

function Kyc() {
  const [risk, setRisk] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const load = () => get(`/v1/admin/kyc?status=in_review${risk ? `&risk=${risk}` : ''}`).then(setRows);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [risk]);
  async function open(id: string) { setSel(await get(`/v1/admin/kyc/${id}`)); setReason(''); setCategory(''); setMsg(null); }
  async function decide(decision: string) {
    try { await post(`/v1/admin/kyc/${sel.id}/decision`, { decision, reason, category: category || undefined }); setMsg({ tone: 'ok', text: 'Decisão registrada na auditoria.' }); setSel(null); load(); }
    catch (e) { const x = e as ApiError; setMsg({ tone: 'bad', text: Object.values(x.fields ?? {})[0] ?? x.title }); }
  }
  const riskPill = (r: string) => <Pill tone={r === 'high' ? 'bad' : r === 'medium' ? 'warn' : 'ok'}>{r === 'high' ? 'Alto' : r === 'medium' ? 'Médio' : 'Baixo'}</Pill>;
  return (<><H>Fila de KYC</H>
    {msg && <Banner tone={msg.tone} className="mb-4">{msg.text}</Banner>}
    <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
      <Card className="p-0">
        <div className="flex items-center justify-between px-5 py-3"><span className="text-[14px] text-ink-mute">Mais antigos primeiro</span><Select label="" aria-label="Filtrar por risco" value={risk} onChange={e => setRisk(e.target.value)} className="w-40"><option value="">Todos os riscos</option><option value="high">Alto</option><option value="medium">Médio</option><option value="low">Baixo</option></Select></div>
        {!rows ? <Skeleton className="m-5 h-32" /> : rows.length === 0 ? <p className="p-5 text-ink-mute">Fila vazia.</p> :
          <table className="w-full text-left text-[14px]"><thead className="border-y border-line bg-canvas/60 text-[12.5px] text-ink-mute"><tr><th className="px-5 py-2">Conta</th><th>Tipo</th><th>Enviado</th><th>Verificações</th><th className="px-5">Risco</th></tr></thead>
            <tbody className="divide-y divide-line">{rows.map(r => { const ch = r.checks as any[]; const ok = ch.filter(c => c.ok === true).length; return (
              <tr key={r.id} onClick={() => open(r.id)} className={cx('cursor-pointer hover:bg-canvas/50', sel?.id === r.id && 'bg-action-soft/40')}><td className="px-5 py-3 font-semibold">{r.name}</td><td className="uppercase">{r.person_type}</td><td className="text-ink-mute">{ago(r.created_at)}</td><td><span className="num">{ok}/{ch.length}</span> OK</td><td className="px-5">{riskPill(r.risk)}</td></tr>); })}</tbody></table>}
      </Card>
      {sel && <Card className="h-fit space-y-4 xl:sticky xl:top-6">
        <div className="flex items-start justify-between gap-2"><div><p className="text-[18px] font-extrabold">{sel.name}</p><p className="num text-[13px] text-ink-mute">{sel.document} · conta criada {shortDate(sel.account_created_at)}</p></div>{riskPill(sel.risk)}</div>
        <div className="grid grid-cols-3 gap-2">{(['front', 'back', 'selfie'] as const).map(k => sel.images[k] ? <button key={k} onClick={() => setZoom(sel.images[k])} className="relative overflow-hidden rounded-ctl border border-line"><img src={sel.images[k]} alt={k} className="h-24 w-full object-cover" /><span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/60 [text-shadow:0_0_2px_#000]">{sel.watermark}</span></button> : <div key={k} className="flex h-24 items-center justify-center rounded-ctl bg-canvas text-[12px] text-ink-mute">sem {k}</div>)}</div>
        <ul className="space-y-1 text-[14px]">{(sel.checks as any[]).map(c => <li key={c.key} className="flex justify-between gap-2"><span>{c.label}</span>{c.ok === true ? <span className="font-bold text-ok">OK</span> : c.ok === false ? <span className="font-bold text-bad">Revisar</span> : <span className="text-ink-mute">—</span>}</li>)}</ul>
        {sel.can_decide ? <>
          <Textarea label="Motivo da decisão (obrigatório)" value={reason} onChange={e => setReason(e.target.value)} hint="Mínimo de 10 caracteres. Fica na auditoria." />
          <Select label="Categoria (para reprovar)" value={category} onChange={e => setCategory(e.target.value)}><option value="">—</option><option value="document_illegible">Documento ilegível</option><option value="document_mismatch">Dados não conferem</option><option value="fraud_suspected">Suspeita de fraude</option><option value="underage">Menor de idade</option><option value="prohibited_activity">Atividade proibida</option><option value="other">Outro</option></Select>
          <div className="grid gap-2 sm:grid-cols-3"><Button variant="ok" onClick={() => decide('approve')}>Aprovar conta</Button><Button variant="secondary" onClick={() => decide('request_docs')}>Pedir documento</Button><Button variant="danger" onClick={() => decide('reject')}>Reprovar</Button></div>
        </> : <Banner tone="info">Você pode ver a fila, mas não tem permissão para decidir.</Banner>}
      </Card>}
    </div>
    <Modal open={!!zoom} onClose={() => setZoom(null)} title="Documento">{zoom && <div className="relative"><img src={zoom} alt="" className="w-full rounded-ctl" /><span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[18px] font-bold text-white/50 [text-shadow:0_0_3px_#000]">{sel?.watermark}</span></div>}</Modal>
  </>);
}

function Moderacao() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => get('/v1/admin/moderation').then(setRows);
  useEffect(() => { load(); }, []);
  return (<><H>Moderação de produtos</H>{msg && <Banner tone="bad" className="mb-3">{msg}</Banner>}
    {!rows ? <Skeleton className="h-32" /> : rows.length === 0 ? <Card>Nada para analisar.</Card> : <div className="space-y-3">{rows.map(p => (
      <Card key={p.id} className="space-y-2"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-bold">{p.name}</p><p className="text-[13.5px] text-ink-mute">{p.account} · {brl(p.price_cents)} · {p.type}</p></div>{p.notes && <Pill tone="warn">{p.notes}</Pill>}</div>
        {p.description && <p className="text-[14px] text-ink-soft">{p.description}</p>}
        <Field label="Motivo" value={reason[p.id] ?? ''} onChange={e => setReason({ ...reason, [p.id]: e.target.value })} />
        <div className="flex gap-2">{(['approve', 'reject'] as const).map(d => <Button key={d} variant={d === 'approve' ? 'ok' : 'danger'} size="sm" onClick={async () => { try { await post(`/v1/admin/moderation/${p.id}/decision`, { decision: d, reason: reason[p.id] ?? '' }); load(); } catch (e) { setMsg(Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title); } }}>{d === 'approve' ? 'Aprovar' : 'Reprovar'}</Button>)}</div></Card>))}</div>}</>);
}

function Disputas() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [act, setAct] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [ev, setEv] = useState<any>(null);
  const load = () => get('/v1/admin/disputes').then(setRows);
  useEffect(() => { load(); }, []);
  return (<><H>Disputas e chargebacks</H>
    <Card className="mb-4"><p className="text-[14px] text-ink-soft">Registrar contestação recebida do gateway em um pedido pago:</p><Pedidos compact onPick={o => setAct({ ...o, stage: 'opened' })} /></Card>
    {!rows ? <Skeleton className="h-24" /> : rows.length === 0 ? <Card>Nenhuma contestação.</Card> : <Card className="p-0"><ul className="divide-y divide-line">{rows.map(o => (
      <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span><span className="num font-semibold">{o.code}</span> · <span className="num">{brl(o.total_cents)}</span> · <StatusBadge status={o.status} label={o.status === 'chargeback' ? 'Em análise' : o.status === 'chargeback_won' ? 'Ganha' : 'Perdida'} /></span>
        <span className="flex gap-2"><Button size="sm" variant="secondary" onClick={async () => setEv(await get(`/v1/admin/orders/${o.id}/evidence`))}>Evidências</Button>{o.status === 'chargeback' && <><Button size="sm" variant="ok" onClick={() => setAct({ ...o, stage: 'won' })}>Ganhamos</Button><Button size="sm" variant="danger" onClick={() => setAct({ ...o, stage: 'lost' })}>Perdemos</Button></>}</span></li>))}</ul></Card>}
    <Modal open={!!act} onClose={() => setAct(null)} title={act?.stage === 'opened' ? 'Registrar contestação' : 'Resultado da contestação'} footer={<Button onClick={async () => { await post(`/v1/admin/orders/${act.id}/chargeback`, { stage: act.stage, reason }); setAct(null); setReason(''); setTimeout(load, 800); }}>Confirmar</Button>}>
      <p className="text-ink-soft">Pedido <b className="num">{act?.code}</b>.</p><Textarea label="Motivo" className="mt-3" value={reason} onChange={e => setReason(e.target.value)} />
    </Modal>
    <Modal open={!!ev} onClose={() => setEv(null)} title="Evidências">{ev && <div className="space-y-2 text-[13.5px]"><p>Pago em {ev.order.paid_at ? dateTime(ev.order.paid_at) : '—'} · UA: {ev.order.user_agent?.slice(0, 60)}</p><p className="font-bold">Acesso às aulas: {ev.lesson_access.length}</p><ul>{ev.lesson_access.map((l: any) => <li key={l.lesson_id}>Aula {l.lesson_id.slice(0, 8)} · primeiro acesso {dateTime(l.first_at)} · {l.completed_at ? 'concluída' : `${l.position_sec}s`}</li>)}</ul></div>}</Modal>
  </>);
}

function Contas() {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[] | null>(null); const [edit, setEdit] = useState<any>(null); const [msg, setMsg] = useState<string | null>(null);
  const load = () => get(`/v1/admin/accounts?q=${encodeURIComponent(q)}`).then(setRows);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);
  return (<><H>Contas</H><Field label="Buscar" value={q} onChange={e => setQ(e.target.value)} placeholder="Nome ou e-mail" className="mb-4 max-w-md" />{msg && <Banner tone="bad" className="mb-3">{msg}</Banner>}
    <Card className="p-0">{!rows ? <Skeleton className="m-5 h-24" /> : <ul className="divide-y divide-line">{rows.map(w => (
      <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span><span className="font-semibold">{w.name}</span> <span className="text-[13px] text-ink-mute">{w.owner_email}</span> <Pill tone={w.kyc_status === 'approved' ? 'ok' : 'warn'}>{w.kyc_status}</Pill> {w.blocked && <Pill tone="bad">Bloqueada</Pill>} {w.custom_fee_bps != null && <Pill tone="action">Taxa {w.custom_fee_bps / 100}%</Pill>} {w.reserve_pct > 0 && <Pill tone="warn">Reserva {w.reserve_pct}% / {w.reserve_days}d</Pill>} {w.payouts_paused && <Pill tone="bad">Saques pausados</Pill>}</span>
        <Button size="sm" variant="secondary" onClick={() => setEdit({ ...w, reason: '', fee: w.custom_fee_bps != null ? String(w.custom_fee_bps / 100) : '', limit: String(w.daily_withdraw_limit / 100), reserve: String(w.reserve_pct), reserveDays: String(w.reserve_days) })}>Gerir</Button></li>))}</ul>}</Card>
    <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.name ?? ''} footer={<><Button variant={edit?.blocked ? 'ok' : 'danger'} onClick={async () => { try { await post(`/v1/admin/accounts/${edit.id}/block`, { blocked: !edit.blocked, reason: edit.reason }); setEdit(null); load(); } catch (e) { setMsg(Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title); setEdit(null); } }}>{edit?.blocked ? 'Desbloquear' : 'Bloquear conta'}</Button><Button onClick={async () => { try { await api('PATCH', `/v1/admin/accounts/${edit.id}/limits`, { custom_fee_bps: edit.fee ? Math.round(Number(edit.fee.replace(',', '.')) * 100) : null, daily_withdraw_limit: Math.round(Number(edit.limit) * 100), reserve_pct: Number(edit.reserve) || 0, reserve_days: Number(edit.reserveDays) || 30, reason: edit.reason }); setEdit(null); load(); } catch (e) { setMsg(Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title); setEdit(null); } }}>Salvar limites</Button></>}>
      {edit && <div className="space-y-3"><Field label="Taxa negociada (%) — vazio = padrão" value={edit.fee} onChange={e => setEdit({ ...edit, fee: e.target.value })} /><Field label="Limite diário de saque (R$)" value={edit.limit} onChange={e => setEdit({ ...edit, limit: e.target.value })} /><div className="grid grid-cols-2 gap-3"><Field label="Reserva de segurança (%)" inputMode="numeric" value={edit.reserve} onChange={e => setEdit({ ...edit, reserve: e.target.value.replace(/\D/g, '') })} hint="0 = segue a regra de contas novas." /><Field label="Retida por (dias)" inputMode="numeric" value={edit.reserveDays} onChange={e => setEdit({ ...edit, reserveDays: e.target.value.replace(/\D/g, '') })} /></div>
        {edit.payouts_paused && <Banner tone="bad">Saques pausados: {edit.payouts_paused_reason}</Banner>}
        <Button variant="secondary" disabled={edit.reason.trim().length < 10} onClick={async () => { try { await post(`/v1/admin/accounts/${edit.id}/payouts`, { paused: !edit.payouts_paused, reason: edit.reason }); setEdit(null); load(); } catch (e) { setMsg(Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title); setEdit(null); } }}>{edit.payouts_paused ? 'Liberar saques' : 'Pausar saques'}</Button><Textarea label="Motivo (obrigatório, vai para a auditoria)" value={edit.reason} onChange={e => setEdit({ ...edit, reason: e.target.value })} /></div>}
    </Modal></>);
}

function Pedidos({ compact, onPick }: { compact?: boolean; onPick?: (o: any) => void }) {
  const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]);
  return (<>{!compact && <H>Pedidos</H>}
    <form className="flex items-end gap-2" onSubmit={async e => { e.preventDefault(); setRows(await get(`/v1/admin/orders?q=${encodeURIComponent(q)}`)); }}><Field label="Código, e-mail ou CPF" value={q} onChange={e => setQ(e.target.value)} className="max-w-md flex-1" /><Button type="submit" variant="secondary">Buscar</Button></form>
    <div className="mt-3 space-y-2">{rows.map(o => <Card key={o.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span><span className="num font-semibold">{o.code}</span> · {o.customer} · <span className="num">{brl(o.total_cents)}</span> <StatusBadge status={o.status} label={o.status_label} /></span>{onPick && o.status === 'paid' ? <Button size="sm" variant="danger" onClick={() => onPick(o)}>Registrar contestação</Button> : null}</div>
      {!compact && <ol className="mt-2 flex flex-wrap gap-2 text-[12.5px] text-ink-mute">{o.timeline.map((t: any, i: number) => <li key={i} className="rounded bg-canvas px-2 py-0.5">{dateTime(t.at)} · {t.event}</li>)}</ol>}</Card>)}</div></>);
}

function Conciliacao() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { get('/v1/admin/reconciliation').then(setD); }, []);
  if (!d) return <Skeleton className="h-32" />;
  return (<><H>Conciliação</H>
    <Banner tone={d.balanced ? 'ok' : 'bad'} className="mb-4">{d.balanced ? 'Livro-razão balanceado: débitos = créditos.' : 'Divergência no livro-razão! Débitos ≠ créditos.'} <span className="num">({brl(d.total_debits)} / {brl(d.total_credits)})</span></Banner>
    <Card className="p-0"><table className="w-full text-left text-[14px]"><thead className="border-b border-line bg-canvas/60 text-[12.5px] text-ink-mute"><tr><th className="px-5 py-2">Dia</th><th>Conta</th><th className="text-right">Débitos</th><th className="px-5 text-right">Créditos</th></tr></thead>
      <tbody className="divide-y divide-line">{d.by_day.map((r: any, i: number) => <tr key={i}><td className="num px-5 py-2">{r.d}</td><td>{r.owner_type}</td><td className="num text-right">{brl(r.debits)}</td><td className="num px-5 text-right">{brl(r.credits)}</td></tr>)}</tbody></table></Card>
    <p className="mt-3 text-[13px] text-ink-mute">A comparação diária com o extrato do gateway roda às 04:30 e gera alerta em caso de divergência.</p></>);
}

function Auditoria() {
  const [d, setD] = useState<any>(null); const [t, setT] = useState('');
  useEffect(() => { const x = setTimeout(() => get(`/v1/admin/audit${t ? `?target=${encodeURIComponent(t)}` : ''}`).then(setD).catch(() => setD({ forbidden: true })), 250); return () => clearTimeout(x); }, [t]);
  if (!d) return <Skeleton className="h-32" />;
  if (d.forbidden) return <Banner tone="bad">Você não tem permissão para ver a auditoria.</Banner>;
  return (<><H>Auditoria</H>
    <Banner tone={d.chain.ok ? 'ok' : 'bad'} className="mb-4">{d.chain.ok ? `Cadeia íntegra: ${d.chain.count} registros com hash encadeado.` : 'Cadeia de auditoria quebrada! Investigar imediatamente.'}</Banner>
    <Field label="Filtrar por alvo" value={t} onChange={e => setT(e.target.value)} placeholder="workspace:…, order:…" className="mb-3 max-w-md" />
    <Card className="p-0">{d.rows.length === 0 && <p className="p-5 text-ink-mute">Nenhum registro ainda.</p>}<ul className="divide-y divide-line text-[13.5px]">{d.rows.map((r: any) => <li key={r.id} className="px-5 py-2.5"><div className="flex flex-wrap justify-between gap-2"><span><b>{r.action}</b> · <span className="num">{r.target}</span> · {r.actor}</span><span className="text-ink-mute">{dateTime(r.created_at)}</span></div>{r.reason && <p className="text-ink-soft">Motivo: {r.reason}</p>}<p className="num truncate text-[11px] text-ink-mute">{r.hash}</p></li>)}</ul></Card></>);
}

function Ajustes() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<any[] | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [f, setF] = useState({ workspace_id: '', sign: '1', amount: '', reason: '' });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [rej, setRej] = useState<any>(null);
  const [note, setNote] = useState('');
  const load = () => get(`/v1/admin/adjustments?status=${status}`).then(setRows).catch((e: ApiError) => setMsg({ tone: 'bad', text: e.code === 'PERMISSION_DENIED' ? 'Só o Financeiro Domma acessa os ajustes de saldo.' : e.title }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);
  useEffect(() => { get('/v1/admin/accounts').then(setAccounts).catch(() => {}); }, []);
  const err = (e: unknown) => { const x = e as ApiError; setMsg({ tone: 'bad', text: Object.values(x.fields ?? {})[0] ?? x.title }); };
  return (<><H>Ajustes de saldo</H>
    <p className="-mt-2 mb-4 max-w-2xl text-[14.5px] text-ink-soft">O saldo nunca é editado: cada ajuste vira um lançamento no livro-razão, com motivo. Uma pessoa do Financeiro pede e <b>outra</b> aprova (RN-38). Tudo fica na auditoria.</p>
    {msg && <Banner tone={msg.tone} className="mb-4">{msg.text}</Banner>}
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card className="h-fit space-y-3">
        <h2 className="font-extrabold">Pedir ajuste</h2>
        <Select label="Conta" value={f.workspace_id} onChange={e => setF({ ...f, workspace_id: e.target.value })}><option value="">Escolha…</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <div className="grid grid-cols-[1fr_1.2fr] gap-2">
          <Select label="Tipo" value={f.sign} onChange={e => setF({ ...f, sign: e.target.value })}><option value="1">Crédito</option><option value="-1">Débito</option></Select>
          <Field label="Valor (R$)" inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: maskMoney(e.target.value) })} mono />
        </div>
        <Textarea label="Motivo (mín. 15 caracteres)" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />
        <Button full onClick={async () => { setMsg(null); try { await post('/v1/admin/adjustments', { workspace_id: f.workspace_id, amount_cents: Number(f.sign) * moneyToCents(f.amount), reason: f.reason }); setF({ workspace_id: '', sign: '1', amount: '', reason: '' }); setMsg({ tone: 'ok', text: 'Pedido criado. Agora outra pessoa do Financeiro precisa aprovar.' }); setStatus('pending'); load(); } catch (e) { err(e); } }}>Pedir ajuste</Button>
      </Card>
      <Card className="p-0">
        <div className="flex items-center justify-between px-5 py-3"><span className="font-extrabold">Pedidos</span><Select label="" aria-label="Filtrar" value={status} onChange={e => setStatus(e.target.value)} className="w-44"><option value="pending">Pendentes</option><option value="approved">Aprovados</option><option value="rejected">Recusados</option><option value="all">Todos</option></Select></div>
        {!rows ? <Skeleton className="m-5 h-24" /> : rows.length === 0 ? <p className="px-5 pb-5 text-ink-mute">Nada por aqui.</p> : <ul className="divide-y divide-line">{rows.map(r => (
          <li key={r.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><b>{r.account}</b> · <span className={cx('num font-bold', r.amount_cents > 0 ? 'text-ok' : 'text-bad')}>{r.amount_cents > 0 ? '+' : '−'}{brl(Math.abs(r.amount_cents))}</span> <Pill tone={r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'warn' : 'neutral'}>{({ pending: 'Pendente', approved: 'Aprovado', rejected: 'Recusado', cancelled: 'Cancelado' } as any)[r.status]}</Pill></span>
              {r.status === 'pending' && <span className="flex gap-2"><Button size="sm" variant="ok" onClick={async () => { try { await post(`/v1/admin/adjustments/${r.id}/approve`, {}); setMsg({ tone: 'ok', text: 'Ajuste aprovado e lançado no livro-razão.' }); load(); } catch (e) { err(e); } }}>Aprovar</Button><Button size="sm" variant="secondary" onClick={() => { setRej(r); setNote(''); }}>Recusar</Button><Button size="sm" variant="ghost" onClick={async () => { try { await post(`/v1/admin/adjustments/${r.id}/cancel`); load(); } catch (e) { err(e); } }}>Cancelar</Button></span>}
            </div>
            <p className="mt-1 text-[14px] text-ink-soft">{r.reason}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-mute">Pedido por {r.requested_by_name} em {dateTime(r.created_at)}{r.decided_by_name ? ` · decidido por ${r.decided_by_name} em ${dateTime(r.decided_at)}` : ''}{r.decision_note ? ` — ${r.decision_note}` : ''}</p>
          </li>))}</ul>}
      </Card>
    </div>
    <Modal open={!!rej} onClose={() => setRej(null)} title="Recusar ajuste" footer={<Button variant="danger" onClick={async () => { try { await post(`/v1/admin/adjustments/${rej.id}/reject`, { note }); setRej(null); load(); } catch (e) { err(e); setRej(null); } }}>Recusar</Button>}>
      <Textarea label="Motivo" value={note} onChange={e => setNote(e.target.value)} />
    </Modal>
  </>);
}

const PKIND: Record<string, string> = { deletion: 'Exclusão', correction: 'Correção', other: 'Outro' };
const PSTATUS: Record<string, string> = { pending: 'Em análise', scheduled: 'Programado', done: 'Concluído', rejected: 'Não atendido' };

/** Pedidos de titulares (LGPD art. 18). Prazo de resposta: 15 dias. */
function Privacidade() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<any[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [decision, setDecision] = useState<'done' | 'rejected'>('done');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => get(`/v1/admin/privacy?status=${status}`).then(setRows).catch((e: ApiError) => setMsg({ tone: 'bad', text: e.code === 'PERMISSION_DENIED' ? 'Só Compliance acessa os pedidos de privacidade.' : e.title }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);
  const late = (r: any) => r.status === 'pending' && Date.now() - new Date(r.created_at).getTime() > 12 * 86400000;
  return (<><H>Pedidos de privacidade (LGPD)</H>
    <p className="-mt-2 mb-4 max-w-2xl text-[14.5px] text-ink-soft">Exclusão de comprador é automática. Aqui ficam as correções, outros pedidos e o encerramento de contas de produtores e afiliados. A LGPD pede resposta em até <b>15 dias</b>.</p>
    {msg && <Banner tone={msg.tone} className="mb-4">{msg.text}</Banner>}
    <Card className="p-0">
      <div className="flex items-center justify-between px-5 py-3"><span className="font-extrabold">Pedidos</span><Select label="" aria-label="Filtrar" value={status} onChange={e => setStatus(e.target.value)}><option value="pending">Em análise</option><option value="scheduled">Programados</option><option value="done">Concluídos</option><option value="rejected">Não atendidos</option><option value="all">Todos</option></Select></div>
      {!rows ? <Skeleton className="m-5 h-24" /> : rows.length === 0 ? <p className="px-5 pb-5 text-ink-mute">Nada por aqui.</p> : <ul className="divide-y divide-line">{rows.map(r => (
        <li key={r.id} className="px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{PKIND[r.kind]} · {r.subject_type === 'customer' ? 'Comprador' : 'Produtor/afiliado'} · {r.subject?.name ?? '—'} <span className="text-ink-mute">{r.subject?.email}</span></span>
            <span className="flex items-center gap-2">{late(r) && <Pill tone="bad">Prazo perto do fim</Pill>}<Pill tone={r.status === 'done' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}>{PSTATUS[r.status]}</Pill></span>
          </div>
          <p className="text-[13.5px] text-ink-mute">Pedido {ago(r.created_at)}{r.retain_until ? ` · anonimização em ${shortDate(r.retain_until)}` : ''}</p>
          {r.details && <p className="mt-1 text-[14px]">“{r.details}”</p>}
          {r.resolution && <p className="mt-1 text-[14px] text-ink-soft">Resposta: {r.resolution}</p>}
          {r.status === 'pending' && <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setSel(r); setDecision('done'); setResolution(''); }}>Responder</Button>}
        </li>))}</ul>}
    </Card>
    <Modal open={!!sel} onClose={() => setSel(null)} title="Responder ao titular"
      footer={<Button full loading={busy} disabled={resolution.trim().length < 10} onClick={async () => { setBusy(true); setMsg(null); try { await post(`/v1/admin/privacy/${sel.id}/decision`, { decision, resolution: resolution.trim() }); setSel(null); setMsg({ tone: 'ok', text: 'Resposta registrada e enviada ao titular.' }); load(); } catch (e) { const x = e as ApiError; setMsg({ tone: 'bad', text: Object.values(x.fields ?? {})[0] ?? x.title }); setSel(null); } setBusy(false); }}>Registrar</Button>}>
      {sel && <>
        {sel.kind === 'deletion' && sel.subject_type === 'user' && <Banner tone="warn">Concluir encerra a conta: bloqueia o acesso, tira as ofertas do ar e agenda a anonimização para daqui a 5 anos. Só funciona se a conta estiver sem saldo, valores a liberar, contestações e saques em andamento.</Banner>}
        <Select label="Decisão" className="mt-3" value={decision} onChange={e => setDecision(e.target.value as any)}><option value="done">Atender</option><option value="rejected">Não atender (explique o motivo legal)</option></Select>
        <Textarea label="Resposta ao titular (vai por e-mail)" className="mt-3" value={resolution} onChange={e => setResolution(e.target.value)} />
      </>}
    </Modal>
  </>);
}
