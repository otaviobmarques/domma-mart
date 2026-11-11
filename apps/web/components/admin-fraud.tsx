'use client';
import { Fragment, useEffect, useState } from 'react';
import { get, post, api, ApiError } from '@/lib/api';
import { brl, dateTime, ago } from '@/lib/format';
import { Button, Card, Field, Textarea, Select, Skeleton, Banner, Pill, Modal, Toggle, cx } from '@/components/ui';

type Signal = { rule: string; points: number; detail: string };
const DECISION: Record<string, [string, 'ok' | 'warn' | 'bad' | 'action']> = { approve: ['Aprovada', 'ok'], three_ds: ['3-D Secure', 'action'], review: ['Revisão', 'warn'], decline: ['Recusada', 'bad'] };
const err = (e: unknown) => Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title;
const TABS = [['revisao', 'Fila de revisão'], ['alertas', 'Alertas'], ['avaliacoes', 'Últimas avaliações'], ['regras', 'Regras e faixas'], ['bloqueios', 'Lista de bloqueio'], ['produtores', 'Risco dos produtores']] as const;

/** Back-office › Antifraude (Fase 2). */
export function Antifraude() {
  const [tab, setTab] = useState<string>('revisao');
  const [ov, setOv] = useState<any>(null);
  const loadOv = () => get('/v1/admin/fraud/overview').then(setOv).catch(() => {});
  useEffect(() => { loadOv(); }, []);
  return (<>
    <h1 className="mb-4 text-[24px] font-extrabold">Antifraude</h1>
    {ov && <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card><p className="text-[13.5px] font-semibold text-ink-mute">Em revisão</p><p className={cx('num mt-1 text-[28px] font-bold', ov.open_reviews > 0 && 'text-warn')}>{ov.open_reviews}</p><p className="num text-[13px] text-ink-mute">{brl(ov.held_cents)} em análise</p></Card>
      <Card><p className="text-[13.5px] font-semibold text-ink-mute">Alertas abertos</p><p className={cx('num mt-1 text-[28px] font-bold', ov.open_alerts > 0 && 'text-bad')}>{ov.open_alerts}</p></Card>
      <Card className="sm:col-span-2"><p className="text-[13.5px] font-semibold text-ink-mute">Compras no cartão (24 h)</p>
        <div className="mt-2 flex flex-wrap gap-2">{Object.entries(DECISION).map(([k, [l, t]]) => <Pill key={k} tone={t}>{l}: <span className="num">{ov.last_24h[k] ?? 0}</span></Pill>)}</div></Card>
    </div>}
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('min-h-[44px] flex-none whitespace-nowrap border-b-2 px-3 text-[14.5px] font-semibold', tab === k ? 'border-action text-action' : 'border-transparent text-ink-mute hover:text-ink')}>{l}</button>)}</div>
    {tab === 'revisao' && <Revisao onChange={loadOv} />}
    {tab === 'alertas' && <Alertas onChange={loadOv} />}
    {tab === 'avaliacoes' && <Avaliacoes />}
    {tab === 'regras' && <Regras />}
    {tab === 'bloqueios' && <Bloqueios />}
    {tab === 'produtores' && <Produtores />}
  </>);
}

function Signals({ s }: { s: Signal[] }) {
  return <ul className="space-y-0.5 text-[13.5px]">{s.map((x, i) => <li key={i} className="flex justify-between gap-3"><span>{x.detail}</span><span className="num font-semibold text-ink-mute">+{x.points}</span></li>)}</ul>;
}

function Revisao({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [block, setBlock] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const load = () => get(`/v1/admin/fraud/reviews?status=${status}`).then(setRows);
  useEffect(() => { setRows(null); load(); /* eslint-disable-next-line */ }, [status]);
  async function decide(kind: 'approve' | 'reject') {
    setBusy(kind); setMsg(null);
    try {
      const r = await post<any>(`/v1/admin/fraud/reviews/${sel.id}/${kind}`, kind === 'reject' ? { reason, block } : { reason });
      setMsg({ tone: 'ok', text: kind === 'approve' ? 'Aprovada: o valor voltou ao saldo do produtor.' : r.refunded ? 'Recusada: a compra foi reembolsada ao comprador.' : 'Recusada.' });
      setSel(null); load(); onChange();
    } catch (e) { setMsg({ tone: 'bad', text: err(e) }); }
    setBusy(null);
  }
  return (<>
    <div className="mb-3 flex items-center justify-between gap-3"><p className="text-[14px] text-ink-mute">Compras no cartão aprovadas pelo banco, mas com pontuação de risco alta. O comprador já tem acesso; o dinheiro do produtor fica “Em análise” até a decisão.</p>
      <Select label="" aria-label="Situação" value={status} onChange={e => setStatus(e.target.value)} className="w-44"><option value="open">Abertas</option><option value="approved">Aprovadas</option><option value="rejected">Recusadas</option><option value="closed">Encerradas</option></Select></div>
    {msg && <Banner tone={msg.tone} className="mb-3">{msg.text}</Banner>}
    <Card className="p-0">{!rows ? <Skeleton className="m-5 h-24" /> : rows.length === 0 ? <p className="p-5 text-ink-mute">Nada aqui.</p> :
      <ul className="divide-y divide-line">{rows.map(r => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0"><p className="font-semibold">{r.order?.product ?? '—'} <span className="num text-ink-mute">#{r.order?.code}</span></p>
            <p className="text-[13.5px] text-ink-mute">{r.account} · {r.buyer?.name} ({r.buyer?.email}) · {r.card ? `${r.card.brand} •••• ${r.card.last4}` : ''} · {ago(r.created_at)}</p></div>
          <div className="flex items-center gap-3"><span className="num font-bold">{brl(r.amount_cents)}</span><Pill tone={r.score >= 85 ? 'bad' : 'warn'}>{r.score} pts</Pill>
            {r.review_status === 'open' ? <Button size="sm" onClick={() => { setSel(r); setReason(''); setBlock([]); }}>Analisar</Button> : <span className="text-[13px] text-ink-mute">{r.review_reason}</span>}</div>
        </li>))}</ul>}</Card>
    <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `Pedido #${sel.order?.code}` : ''}
      footer={<><Button variant="danger" loading={busy === 'reject'} disabled={reason.trim().length < 10 || !!busy} onClick={() => decide('reject')}>Recusar e reembolsar</Button><Button variant="ok" loading={busy === 'approve'} disabled={reason.trim().length < 10 || !!busy} onClick={() => decide('approve')}>Aprovar</Button></>}>
      {sel && <div className="space-y-3 text-[14.5px]">
        <div className="rounded-ctl bg-canvas p-3"><p><b>{sel.buyer?.name}</b> · {sel.buyer?.document} · {sel.buyer?.email}</p><p className="text-ink-mute">{sel.account} · {sel.order?.product} · <span className="num">{brl(sel.amount_cents)}</span>{sel.order?.installments > 1 ? ` em ${sel.order.installments}x` : ''}</p></div>
        <div><p className="mb-1 font-semibold">Por que caiu em revisão ({sel.score} pontos{sel.gateway_score != null ? `, gateway ${sel.gateway_score}/100` : ''})</p><Signals s={sel.signals} /></div>
        <Textarea label="Motivo da decisão (vai para a auditoria)" value={reason} onChange={e => setReason(e.target.value)} />
        <fieldset><legend className="mb-1 font-semibold">Se recusar, bloquear também</legend>
          {[['cpf', 'CPF'], ['email', 'E-mail'], ['device', 'Aparelho'], ['ip', 'IP']].map(([k, l]) => <Toggle key={k} label={l} checked={block.includes(k)} onChange={v => setBlock(v ? [...block, k] : block.filter(x => x !== k))} />)}
        </fieldset>
      </div>}
    </Modal>
  </>);
}

function Alertas({ onChange }: { onChange: () => void }) {
  const [all, setAll] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const load = () => get(`/v1/admin/fraud/alerts${all ? '?all=1' : ''}`).then(setRows);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [all]);
  return (<>
    <div className="mb-3 flex items-center justify-between gap-3">
      <Toggle label="Mostrar também os já vistos" checked={all} onChange={setAll} />
      <Button size="sm" variant="secondary" onClick={async () => { await post('/v1/admin/fraud/scan-producers'); load(); onChange(); }}>Verificar chargeback agora</Button>
    </div>
    <Card className="p-0">{!rows ? <Skeleton className="m-5 h-24" /> : rows.length === 0 ? <p className="p-5 text-ink-mute">Nenhum alerta.</p> :
      <ul className="divide-y divide-line">{rows.map(a => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0"><p className="font-semibold"><Pill tone={a.level === 'high' ? 'bad' : a.level === 'warn' ? 'warn' : 'action'}>{a.level === 'high' ? 'Alto' : a.level === 'warn' ? 'Médio' : 'Info'}</Pill> {a.message}</p><p className="text-[13px] text-ink-mute">{dateTime(a.created_at)}</p></div>
          {!a.acknowledged_at ? <Button size="sm" variant="ghost" onClick={async () => { await post(`/v1/admin/fraud/alerts/${a.id}/ack`); load(); onChange(); }}>Marcar como visto</Button> : <span className="text-[13px] text-ink-mute">visto</span>}
        </li>))}</ul>}</Card>
  </>);
}

function Avaliacoes() {
  const [d, setD] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setRows(null); get(`/v1/admin/fraud/assessments${d ? `?decision=${d}` : ''}`).then(setRows); }, [d]);
  return (<>
    <Select label="" aria-label="Faixa" value={d} onChange={e => setD(e.target.value)} className="mb-3 w-52"><option value="">Todas as faixas</option>{Object.entries(DECISION).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
    <Card className="p-0">{!rows ? <Skeleton className="m-5 h-24" /> : <table className="w-full text-left text-[14px]"><thead className="border-b border-line bg-canvas/60 text-[12.5px] text-ink-mute"><tr><th className="px-5 py-2">Quando</th><th>Conta</th><th className="text-right">Valor</th><th className="text-right">Pontos</th><th className="px-5">Faixa</th></tr></thead>
      <tbody className="divide-y divide-line">{rows.map(r => (<Fragment key={r.id}>
        <tr className="cursor-pointer hover:bg-canvas/50" onClick={() => setOpen(open === r.id ? null : r.id)}><td className="px-5 py-2.5">{dateTime(r.created_at)}</td><td>{r.account}</td><td className="num text-right">{brl(r.amount_cents)}</td><td className="num text-right">{r.score}</td><td className="px-5"><Pill tone={DECISION[r.decision]?.[1]}>{DECISION[r.decision]?.[0]}</Pill>{!r.has_order && <span className="ml-2 text-[12.5px] text-ink-mute">sem pedido</span>}</td></tr>
        {open === r.id && <tr><td colSpan={5} className="bg-canvas/40 px-5 py-2">{r.signals.length ? <Signals s={r.signals} /> : <span className="text-ink-mute">Nenhuma regra disparou.</span>}</td></tr>}
      </Fragment>))}</tbody></table>}</Card>
  </>);
}

function Regras() {
  const [d, setD] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => { get('/v1/admin/fraud/config').then(x => { setD(x); setCfg(structuredClone(x.config)); }); }, []);
  if (!d || !cfg) return <Skeleton className="h-64 w-full" />;
  const n = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')));
  const setRule = (k: string, patch: any) => setCfg({ ...cfg, rules: { ...cfg.rules, [k]: { ...cfg.rules[k], ...patch } } });
  const PARAM: Record<string, [string, string][]> = {
    velocity_cpf: [['max', 'Máx.'], ['window_min', 'Janela (min)']], velocity_ip: [['max', 'Máx.'], ['window_min', 'Janela (min)']], velocity_device: [['max', 'Máx.'], ['window_min', 'Janela (min)']],
    identities_device: [['max', 'Máx. CPFs'], ['window_min', 'Janela (min)']], recent_declines: [['max', 'Recusas'], ['window_min', 'Janela (min)']],
    new_buyer_high_amount: [['amount_cents', 'A partir de (R$)']], night: [['from_h', 'Das (h)'], ['to_h', 'Até (h)']], gateway_score: [['weight', 'Peso']],
  };
  async function save() {
    setMsg(null);
    try { const r = await api('PUT', '/v1/admin/fraud/config', { ...cfg, reason }); setCfg(r.config); setReason(''); setMsg({ tone: 'ok', text: 'Regras salvas. Valem para as próximas compras.' }); }
    catch (e) { setMsg({ tone: 'bad', text: err(e) }); }
  }
  return (<div className="space-y-4">
    <Card className="space-y-3"><h2 className="font-extrabold">Faixas de decisão</h2>
      <p className="text-[14px] text-ink-mute">Cada regra que dispara soma pontos. Pela soma: abaixo de 3-D Secure aprova; na faixa 3-D Secure, sem a confirmação do banco, vai para revisão; na revisão o dinheiro do produtor fica em análise; a partir da recusa, a compra no cartão é recusada e o comprador é convidado a pagar com Pix.</p>
      <div className="grid gap-3 sm:grid-cols-3">{[['three_ds', '3-D Secure a partir de'], ['review', 'Revisão a partir de'], ['decline', 'Recusa a partir de']].map(([k, l]) => <Field key={k} label={l} inputMode="numeric" value={String(cfg.bands[k])} onChange={e => setCfg({ ...cfg, bands: { ...cfg.bands, [k]: n(e.target.value) } })} mono />)}</div></Card>
    <Card className="p-0"><table className="w-full text-left text-[14px]"><thead className="border-b border-line bg-canvas/60 text-[12.5px] text-ink-mute"><tr><th className="px-5 py-2">Regra</th><th>Ligada</th><th>Pontos</th><th className="px-5">Parâmetros</th></tr></thead>
      <tbody className="divide-y divide-line">{Object.keys(cfg.rules).map(k => (
        <tr key={k} className={cx(!cfg.rules[k].enabled && 'opacity-60')}><td className="px-5 py-2.5"><p className="font-semibold">{d.info[k]?.name ?? k}</p><p className="text-[13px] text-ink-mute">{d.info[k]?.help}</p></td>
          <td><input type="checkbox" aria-label={`Ligar ${d.info[k]?.name}`} className="h-5 w-5" checked={cfg.rules[k].enabled} onChange={e => setRule(k, { enabled: e.target.checked })} /></td>
          <td>{k === 'gateway_score' ? <span className="text-[13px] text-ink-mute">score × peso</span> : <input aria-label={`Pontos ${d.info[k]?.name}`} className="num w-16 rounded-ctl border border-line px-2 py-1.5" inputMode="numeric" value={cfg.rules[k].points} onChange={e => setRule(k, { points: n(e.target.value) })} />}</td>
          <td className="px-5"><div className="flex flex-wrap gap-2">{(PARAM[k] ?? []).map(([p, l]) => <label key={p} className="text-[12.5px] text-ink-mute">{l}<input className="num ml-1 w-20 rounded-ctl border border-line px-2 py-1.5 text-[14px] text-ink" inputMode="decimal" value={p === 'amount_cents' ? String((cfg.rules[k][p] ?? 0) / 100) : cfg.rules[k][p] ?? ''} onChange={e => setRule(k, { [p]: p === 'amount_cents' ? Math.round(n(e.target.value) * 100) : n(e.target.value) })} /></label>)}</div></td></tr>))}</tbody></table></Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3"><h2 className="font-extrabold">Reserva automática para contas novas</h2>
        <p className="text-[14px] text-ink-mute">Parte do valor de cada venda fica “Chegando” por mais tempo em contas novas (criadas há pouco tempo ou com poucas vendas). Use 0% para desligar. Contas com reserva própria (em Contas) seguem a delas.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reserva (%)" inputMode="numeric" value={String(cfg.reserve.new_account_pct)} onChange={e => setCfg({ ...cfg, reserve: { ...cfg.reserve, new_account_pct: n(e.target.value) } })} mono />
          <Field label="Retida por (dias)" inputMode="numeric" value={String(cfg.reserve.new_account_days)} onChange={e => setCfg({ ...cfg, reserve: { ...cfg.reserve, new_account_days: n(e.target.value) } })} mono />
          <Field label="Conta nova: menos de (dias)" inputMode="numeric" value={String(cfg.reserve.account_age_days)} onChange={e => setCfg({ ...cfg, reserve: { ...cfg.reserve, account_age_days: n(e.target.value) } })} mono />
          <Field label="ou menos de (vendas pagas)" inputMode="numeric" value={String(cfg.reserve.min_paid_orders)} onChange={e => setCfg({ ...cfg, reserve: { ...cfg.reserve, min_paid_orders: n(e.target.value) } })} mono />
        </div></Card>
      <Card className="space-y-3"><h2 className="font-extrabold">Chargeback do produtor (30 dias)</h2>
        <p className="text-[14px] text-ink-mute">Verificado todo dia. Na pausa, os saques da conta param (as vendas continuam) até a equipe liberar em Contas.</p>
        <div className="grid grid-cols-2 gap-3">{[['alert_pct', 'Alerta a partir de (%)'], ['review_pct', 'Revisão a partir de (%)'], ['pause_pct', 'Pausar saques a partir de (%)'], ['min_orders', 'Só com pelo menos (vendas)']].map(([k, l]) => <Field key={k} label={l} inputMode="decimal" value={String(cfg.producer[k])} onChange={e => setCfg({ ...cfg, producer: { ...cfg.producer, [k]: n(e.target.value) } })} mono />)}</div></Card>
    </div>
    <Card className="max-w-xl space-y-3">{msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <Textarea label="Motivo da mudança (vai para a auditoria)" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="flex gap-2"><Button disabled={reason.trim().length < 10} onClick={save}>Salvar regras</Button><Button variant="ghost" onClick={() => setCfg(structuredClone(d.defaults))}>Voltar ao padrão</Button></div></Card>
  </div>);
}

const KIND: Record<string, string> = { cpf: 'CPF/CNPJ', email: 'E-mail', email_domain: 'Domínio de e-mail', ip: 'IP', device: 'Aparelho', bin: 'BIN do cartão' };

function Bloqueios() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [b, setB] = useState({ kind: 'cpf', value: '', reason: '', days: '' });
  const [del, setDel] = useState<any>(null);
  const [delReason, setDelReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const load = () => get('/v1/admin/blocklist').then(setRows);
  useEffect(() => { load(); }, []);
  return (<div className="grid gap-4 lg:grid-cols-[1fr_360px]">
    <Card className="p-0">{!rows ? <Skeleton className="m-5 h-24" /> : rows.length === 0 ? <p className="p-5 text-ink-mute">Lista vazia.</p> :
      <ul className="divide-y divide-line">{rows.map(r => (
        <li key={r.id} className={cx('flex flex-wrap items-center justify-between gap-3 px-5 py-3', r.expired && 'opacity-60')}>
          <div className="min-w-0"><p className="font-semibold"><Pill>{KIND[r.kind] ?? r.kind}</Pill> {r.label ?? '—'}</p><p className="text-[13px] text-ink-mute">{r.reason} · {dateTime(r.created_at)}{r.expires_at ? ` · ${r.expired ? 'expirou' : 'até'} ${dateTime(r.expires_at)}` : ' · sem validade'}</p></div>
          <Button size="sm" variant="ghost" className="text-bad" onClick={() => { setDel(r); setDelReason(''); }}>Remover</Button>
        </li>))}</ul>}</Card>
    <Card className="space-y-3 self-start"><h2 className="font-extrabold">Bloquear</h2>{msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <Select label="Tipo" value={b.kind} onChange={e => setB({ ...b, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      <Field label="Valor" value={b.value} onChange={e => setB({ ...b, value: e.target.value })} hint={b.kind === 'bin' ? '6 a 8 primeiros números do cartão.' : b.kind === 'device' ? 'Identificador do aparelho (aparece no pedido).' : undefined} />
      <Field label="Motivo" value={b.reason} onChange={e => setB({ ...b, reason: e.target.value })} />
      <Field label="Validade em dias (vazio = sem validade)" inputMode="numeric" value={b.days} onChange={e => setB({ ...b, days: e.target.value.replace(/\D/g, '') })} />
      <Button onClick={async () => { setMsg(null); try { await post('/v1/admin/blocklist', { kind: b.kind, value: b.value, reason: b.reason, days: b.days ? Number(b.days) : undefined }); setMsg({ tone: 'ok', text: 'Bloqueio adicionado.' }); setB({ ...b, value: '', reason: '', days: '' }); load(); } catch (e) { setMsg({ tone: 'bad', text: err(e) }); } }}>Bloquear</Button>
    </Card>
    <Modal open={!!del} onClose={() => setDel(null)} title="Remover bloqueio" footer={<Button variant="danger" disabled={delReason.trim().length < 10} onClick={async () => { try { await api('DELETE', `/v1/admin/blocklist/${del.id}`, { reason: delReason }); setDel(null); load(); } catch (e) { setMsg({ tone: 'bad', text: err(e) }); setDel(null); } }}>Remover</Button>}>
      {del && <><p className="mb-3 text-[14.5px]">{KIND[del.kind]} {del.label}</p><Textarea label="Motivo (vai para a auditoria)" value={delReason} onChange={e => setDelReason(e.target.value)} /></>}
    </Modal>
  </div>);
}

function Produtores() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { get('/v1/admin/risk').then(setRows); }, []);
  const tone = (l: string) => (l === 'ok' ? 'ok' : l === 'alerta' ? 'warn' : 'bad');
  return <Card className="p-0">{!rows ? <Skeleton className="m-5 h-24" /> : <table className="w-full text-left text-[14px]"><thead className="border-b border-line bg-canvas/60 text-[12.5px] text-ink-mute"><tr><th className="px-5 py-2">Conta</th><th className="text-right">Pagos (30d)</th><th className="text-right">Chargeback</th><th className="text-right">Reembolso</th><th className="px-5">Nível</th></tr></thead>
    <tbody className="divide-y divide-line">{rows.map(r => <tr key={r.workspace_id}><td className="px-5 py-2.5 font-semibold">{r.name}{r.paused && <Pill tone="bad">saques pausados</Pill>}</td><td className="num text-right">{r.paid}</td><td className="num text-right">{r.chargeback_pct}%</td><td className="num text-right">{r.refund_pct}%</td><td className="px-5"><Pill tone={tone(r.level)}>{r.level}</Pill>{!r.enough_orders && <span className="ml-2 text-[12.5px] text-ink-mute">poucas vendas</span>}</td></tr>)}</tbody></table>}</Card>;
}
