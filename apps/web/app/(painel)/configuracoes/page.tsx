'use client';
import { useEffect, useState } from 'react';
import { get, post, api, ApiError } from '@/lib/api';
import { ago, dateTime, maskPhone } from '@/lib/format';
import { useMe } from '@/components/session';
import { Button, Card, Field, Textarea, Toggle, Banner, Pill, Modal, CopyButton, cx } from '@/components/ui';

const TABS = [['seguranca', 'Perfil e segurança'], ['equipe', 'Equipe'], ['empresa', 'Dados da empresa'], ['notificacoes', 'Notificações'], ['recuperacao', 'Recuperação de vendas'], ['integracoes', 'Integrações'], ['dominio', 'Domínio próprio']] as const;
const PERM: Record<string, string> = { 'dashboard.view': 'Ver início', 'products.edit': 'Editar produtos', 'orders.view': 'Ver vendas', 'orders.refund': 'Reembolsar', 'finance.view': 'Ver financeiro', 'finance.withdraw': 'Sacar', 'affiliates.manage': 'Gerir afiliados', 'settings.manage': 'Configurações', 'team.manage': 'Gerir equipe' };

export default function Config() {
  const [tab, setTab] = useState('seguranca');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => { const a = new URLSearchParams(location.search).get('aba'); if (a) setTab(a); }, []);
  return (
    <div>
      <h1 className="text-[26px] font-extrabold">Configurações</h1>
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setMsg(null); }} className={cx('min-h-[44px] flex-none whitespace-nowrap border-b-2 px-3 text-[14.5px] font-semibold', tab === k ? 'border-action text-action' : 'border-transparent text-ink-mute')}>{l}</button>)}</div>
      {msg && <Banner tone={msg.tone} className="mt-4">{msg.text}</Banner>}
      <div className="mt-5">
        {tab === 'seguranca' && <Seguranca setMsg={setMsg} />}
        {tab === 'equipe' && <Equipe setMsg={setMsg} />}
        {tab === 'empresa' && <Empresa setMsg={setMsg} />}
        {tab === 'notificacoes' && <Notificacoes />}
        {tab === 'recuperacao' && <Recuperacao setMsg={setMsg} />}
        {tab === 'integracoes' && <Integracoes setMsg={setMsg} />}
        {tab === 'dominio' && <Dominio setMsg={setMsg} />}
      </div>
    </div>
  );
}

function Seguranca({ setMsg }: any) {
  const { me, reload } = useMe();
  const [sessions, setSessions] = useState<any[]>([]);
  const [totp, setTotp] = useState<any>(null);
  const [code, setCode] = useState('');
  const load = () => get('/v1/auth/sessions').then(setSessions);
  useEffect(() => { load(); }, []);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h2 className="font-extrabold">Perfil</h2><p className="mt-2">{me.user.name}</p><p className="text-ink-mute">{me.user.email} {me.user.email_verified ? <Pill tone="ok">Confirmado</Pill> : <Pill tone="warn">Não confirmado</Pill>}</p>
        <a href="/esqueci-senha" className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-action">Trocar senha</a></Card>
      <Card><h2 className="font-extrabold">Verificação em duas etapas</h2>
        {me.user.totp_enabled ? <p className="mt-2 text-ok">✓ Ativa. Pedimos o código para saques, troca de conta bancária, equipe e chaves de API.</p> : <><p className="mt-2 text-ink-soft">Obrigatória para sacar. Use um aplicativo autenticador.</p><Button className="mt-3" onClick={async () => setTotp(await post('/v1/auth/2fa/setup'))}>Ativar</Button></>}</Card>
      <Card className="lg:col-span-2"><div className="flex items-center justify-between"><h2 className="font-extrabold">Aparelhos conectados</h2><Button size="sm" variant="secondary" onClick={async () => { await post('/v1/auth/logout-all'); load(); setMsg({ tone: 'ok', text: 'Saímos de todos os outros aparelhos.' }); }}>Sair de todos os outros</Button></div>
        <ul className="mt-2 divide-y divide-line">{sessions.map(s => <li key={s.id} className="flex min-h-[52px] items-center justify-between gap-3"><span className="min-w-0"><span className="block truncate text-[14px]">{s.user_agent ?? 'Navegador'}</span><span className="text-[13px] text-ink-mute">ativo {ago(s.last_seen_at)}</span></span>{s.current ? <Pill tone="action">Este aparelho</Pill> : <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await api('DELETE', `/v1/auth/sessions/${s.id}`); load(); }}>Encerrar</Button>}</li>)}</ul></Card>
      <Modal open={!!totp} onClose={() => setTotp(null)} title="Ativar verificação em duas etapas" footer={<Button full disabled={code.length !== 6} onClick={async () => { try { await post('/v1/auth/2fa/enable', { code }); setTotp(null); reload(); setMsg({ tone: 'ok', text: 'Verificação em duas etapas ativada.' }); } catch (e) { setMsg({ tone: 'bad', text: (e as ApiError).title }); } }}>Ativar</Button>}>
        {totp && <><img src={totp.qr} alt="QR Code" className="mx-auto h-48 w-48" /><p className="num break-all text-center text-[12px] text-ink-mute">{totp.secret}</p><Field className="mt-3" label="Código do aplicativo" inputMode="numeric" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} mono big /></>}
      </Modal>
    </div>
  );
}

function Equipe({ setMsg }: any) {
  const [t, setT] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState<string[]>(['orders.view']);
  const load = () => get('/v1/settings/team').then(setT).catch((e: ApiError) => setMsg({ tone: 'bad', text: e.title }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  if (!t) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><h2 className="font-extrabold">Pessoas</h2><ul className="mt-2 divide-y divide-line">{t.members.map((m: any) => <li key={m.id} className="py-3"><div className="flex items-center justify-between gap-2"><span><span className="font-semibold">{m.name}</span> <span className="text-[13px] text-ink-mute">{m.email}</span></span>{m.role === 'owner' ? <Pill tone="action">Dono</Pill> : <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await api('DELETE', `/v1/settings/team/${m.id}`); load(); }}>Remover</Button>}</div>{m.role !== 'owner' && <p className="mt-1 text-[13px] text-ink-mute">{m.permissions.map((p: string) => PERM[p]).join(' · ')}</p>}</li>)}</ul></Card>
      <Card className="space-y-3"><h2 className="font-extrabold">Convidar pessoa</h2>
        <Field label="E-mail (precisa ter conta Domma Mart)" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <fieldset><legend className="mb-1 font-semibold">O que essa pessoa pode fazer</legend><div className="grid gap-1 sm:grid-cols-2">{t.permissions.map((p: string) => <label key={p} className="flex min-h-[36px] items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#5B3FE6]" checked={perms.includes(p)} onChange={e => setPerms(e.target.checked ? [...perms, p] : perms.filter(x => x !== p))} />{PERM[p]}</label>)}</div></fieldset>
        <Button onClick={async () => { try { await post('/v1/settings/team', { email, permissions: perms }); setEmail(''); load(); setMsg({ tone: 'ok', text: 'Pessoa adicionada à equipe.' }); } catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); } }}>Adicionar</Button>
      </Card>
    </div>
  );
}

function Empresa({ setMsg }: any) {
  const { me, reload } = useMe();
  const [v, setV] = useState({ name: me.workspace.name, support_whatsapp: me.workspace.support_whatsapp ? maskPhone(me.workspace.support_whatsapp) : '', support_email: me.workspace.support_email ?? '' });
  return (
    <Card className="max-w-xl space-y-4">
      <Field label="Nome que aparece para o cliente" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} />
      <Field label="WhatsApp de suporte" type="tel" value={v.support_whatsapp} onChange={e => setV({ ...v, support_whatsapp: maskPhone(e.target.value) })} hint="Aparece no botão “Falar com o produtor”." />
      <Field label="E-mail de suporte" type="email" value={v.support_email} onChange={e => setV({ ...v, support_email: e.target.value })} />
      <Button onClick={async () => { try { await api('PATCH', '/v1/settings/workspace', { name: v.name, support_whatsapp: v.support_whatsapp || null, support_email: v.support_email || null }); reload(); setMsg({ tone: 'ok', text: 'Dados salvos.' }); } catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); } }}>Salvar</Button>
    </Card>
  );
}

function Notificacoes() {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { get('/v1/settings/notifications').then(setList); }, []);
  return (
    <Card><h2 className="font-extrabold">Avisos enviados</h2><p className="text-[14px] text-ink-mute">Venda aprovada, reembolso, contestação e saque chegam por e-mail e WhatsApp.</p>
      <ul className="mt-3 divide-y divide-line">{list.map(n => <li key={n.id} className="flex min-h-[48px] items-center justify-between gap-3 text-[14px]"><span><Pill>{n.channel}</Pill> {n.template} · {n.to_masked}</span><span className="text-ink-mute">{dateTime(n.created_at)}</span></li>)}</ul></Card>
  );
}

function Recuperacao({ setMsg }: any) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { get('/v1/settings/recovery').then(setD); }, []);
  if (!d) return null;
  const s = d.settings;
  const set = (p: any) => setD({ ...d, settings: { ...s, ...p } });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="space-y-2 lg:col-span-2">
        <h2 className="font-extrabold">Quando lembrar o cliente</h2>
        <Toggle label="Pix gerado e não pago" checked={s.pix_unpaid} onChange={v => set({ pix_unpaid: v })} />
        <Toggle label="Boleto gerado e não pago" checked={s.boleto_unpaid} onChange={v => set({ boleto_unpaid: v })} />
        <Toggle label="Cartão recusado" checked={s.card_declined} onChange={v => set({ card_declined: v })} />
        <Toggle label="Checkout abandonado" hint="Preencheu o e-mail e não comprou em 30 min." checked={s.abandoned} onChange={v => set({ abandoned: v })} />
        <h2 className="pt-3 font-extrabold">Por onde</h2>
        <Toggle label="E-mail" checked={s.email} onChange={v => set({ email: v })} />
        <Toggle label="WhatsApp (Domma Chat)" hint="Usa modelos aprovados pela Meta. O cliente pode responder SAIR." checked={s.whatsapp} onChange={v => set({ whatsapp: v })} />
        <h2 className="pt-3 font-extrabold">Horários</h2>
        <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map(i => <Field key={i} label={`${i + 1}ª mensagem (min)`} type="number" min={5} value={s.delays_min[i] ?? ''} onChange={e => { const x = [...s.delays_min]; x[i] = Number(e.target.value); set({ delays_min: x.filter((n: number) => n > 0) }); }} />)}</div>
        <Textarea label="Texto" value={s.template} onChange={e => set({ template: e.target.value })} hint="Variáveis: {nome}, {produto}, {link}" />
        <Button onClick={async () => { try { await api('PUT', '/v1/settings/recovery', { pix_unpaid: s.pix_unpaid, boleto_unpaid: s.boleto_unpaid, card_declined: s.card_declined, abandoned: s.abandoned, email: s.email, whatsapp: s.whatsapp, delays_min: s.delays_min, template: s.template }); setMsg({ tone: 'ok', text: 'Recuperação salva.' }); } catch (e) { setMsg({ tone: 'bad', text: (e as ApiError).title }); } }}>Salvar</Button>
      </Card>
      <Card><p className="text-[14px] font-semibold text-ink-mute">Vendas recuperadas</p><p className="num mt-1 text-[28px] font-bold">{Number(d.recovered.n)}</p><p className="num text-ink-mute">{(Number(d.recovered.cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p></Card>
    </div>
  );
}

function Integracoes({ setMsg }: any) {
  const [d, setD] = useState<any>(null);
  const [url, setUrl] = useState('');
  const [ev, setEv] = useState<string[]>(['order.paid']);
  const [secret, setSecret] = useState<string | null>(null);
  const load = () => get('/v1/settings/webhooks').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return null;
  return (
    <div className="space-y-4">
      <Card className="space-y-3"><h2 className="font-extrabold">Conectar com outro sistema (webhook)</h2>
        <p className="text-[14px] text-ink-soft">Enviamos um POST assinado (cabeçalho <span className="num">X-DommaMart-Signature</span>, HMAC-SHA256 de “t.payload”) a cada evento. Rejeite eventos com mais de 5 minutos.</p>
        <Field label="URL (https)" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://seusistema.com/webhooks/domma" />
        <fieldset><legend className="mb-1 font-semibold">Eventos</legend><div className="grid gap-1 sm:grid-cols-3">{d.events.map((e: string) => <label key={e} className="flex min-h-[36px] items-center gap-2 text-[14px]"><input type="checkbox" className="h-4 w-4 accent-[#5B3FE6]" checked={ev.includes(e)} onChange={x => setEv(x.target.checked ? [...ev, e] : ev.filter(y => y !== e))} /><span className="num">{e}</span></label>)}</div></fieldset>
        <Button onClick={async () => { try { const r = await post('/v1/settings/webhooks', { url, events: ev }); setSecret(r.secret); setUrl(''); load(); } catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); } }}>Adicionar webhook</Button>
      </Card>
      <Card><h2 className="font-extrabold">Seus webhooks</h2>
        {d.endpoints.length === 0 ? <p className="mt-2 text-ink-mute">Nenhum ainda.</p> : <ul className="mt-2 divide-y divide-line">{d.endpoints.map((e: any) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="min-w-0"><span className="num block truncate text-[14px]">{e.url}</span><span className="text-[13px] text-ink-mute">{e.events.join(', ')}</span></span><span className="flex items-center gap-2">{e.active ? <Pill tone="ok">Ativo</Pill> : <Pill tone="bad">Desativado</Pill>}{e.active && <><Button size="sm" variant="secondary" onClick={async () => { const r = await post(`/v1/settings/webhooks/${e.id}/test`); setMsg({ tone: r.delivered_at ? 'ok' : 'bad', text: r.delivered_at ? `Teste entregue (HTTP ${r.last_status}).` : `Falhou: ${r.last_error}` }); load(); }}>Testar</Button><Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await api('DELETE', `/v1/settings/webhooks/${e.id}`); load(); }}>Remover</Button></>}</span></li>)}</ul>}
        {d.deliveries.length > 0 && <><h3 className="mt-4 text-[14px] font-bold">Últimas entregas</h3><ul className="mt-1 text-[13.5px]">{d.deliveries.slice(0, 10).map((x: any) => <li key={x.id} className="flex justify-between gap-3 py-1"><span className="num">{x.event_type}</span><span className={x.delivered_at ? 'text-ok' : 'text-bad'}>{x.delivered_at ? `✓ ${x.last_status}` : `${x.attempts} tentativas · ${x.last_error ?? 'aguardando'}`}</span></li>)}</ul></>}
      </Card>
      <Card><h2 className="font-extrabold">Outras integrações</h2><ul className="mt-2 space-y-2 text-[14.5px]"><li><b>Domma CRM e Domma Chat</b> — lead e venda com fonte de dados; recuperação por WhatsApp. <span className="text-ink-mute">Configurado pela equipe Domma.</span></li><li><b>Pixel Meta, GA4, Google Ads, TikTok</b> — em cada produto, aba Pixels.</li><li><b>UTMify</b> — use um webhook com os eventos <span className="num">order.paid</span> e <span className="num">order.refunded</span>.</li><li><b>API pública</b> — chegando na Fase 2.</li></ul></Card>
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Guarde este segredo"><p className="text-ink-soft">Use para validar a assinatura. Ele não será mostrado de novo.</p><p id="copy-src" className="num mt-3 break-all rounded-ctl bg-canvas p-3 text-[13px]">{secret}</p><div className="mt-3"><CopyButton text={secret ?? ''} full variant="primary" /></div></Modal>
    </div>
  );
}

function Dominio({ setMsg }: any) {
  const [d, setD] = useState<any>(null);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => get('/v1/settings/domains').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const err = (e: unknown) => { const x = e as ApiError; setMsg({ tone: 'bad', text: Object.values(x.fields ?? {})[0] ?? x.title }); };
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="font-extrabold">Use o seu domínio na página de pagamento</h2>
        <p className="text-[14.5px] text-ink-soft">Seu cliente compra em <span className="num">pay.seusite.com.br/{d.example_slug ?? 'seu-produto'}</span>, com cadeado de segurança (SSL) automático. Nesse endereço aparecem só os seus produtos.</p>
        {!d.enabled ? <Banner tone="info">O domínio próprio ainda não está ligado nesta conta. Fale com o suporte para ativar.</Banner> : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Seu domínio" placeholder="pay.seusite.com.br" value={host} onChange={e => setHost(e.target.value.toLowerCase())} className="min-w-[240px] flex-1" />
            <Button loading={busy === 'add'} onClick={async () => { setBusy('add'); setMsg(null); try { await post('/v1/settings/domains', { hostname: host }); setHost(''); load(); setMsg({ tone: 'ok', text: 'Domínio cadastrado. Agora crie o registro no DNS abaixo.' }); } catch (e) { err(e); } setBusy(null); }}>Adicionar domínio</Button>
          </div>
        )}
      </Card>
      {d.domains.map((x: any) => (
        <Card key={x.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="num text-[16px] font-bold">{x.hostname}</span>
            <span className="flex items-center gap-2">{x.status === 'active' ? <Pill tone="ok">Ativo</Pill> : <Pill tone="warn">Aguardando DNS</Pill>}
              {x.status !== 'active' && d.enabled && <Button size="sm" variant="secondary" loading={busy === x.id} onClick={async () => { setBusy(x.id); try { const r = await post(`/v1/settings/domains/${x.id}/verify`); setMsg(r.status === 'active' ? { tone: 'ok', text: `${x.hostname} está ativo!` } : { tone: 'bad', text: r.last_error ?? 'Ainda não encontramos o registro no DNS.' }); load(); } catch (e) { err(e); } setBusy(null); }}>Verificar agora</Button>}
              <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { if (confirm(`Remover ${x.hostname}?`)) { await api('DELETE', `/v1/settings/domains/${x.id}`); load(); } }}>Remover</Button></span>
          </div>
          {x.status === 'active' ? (
            <p className="text-[14.5px]">Seus links: <span className="num">https://{x.hostname}/{d.example_slug ?? 'codigo-da-oferta'}</span></p>
          ) : (
            <>
              <p className="text-[14.5px] text-ink-soft">No painel onde você comprou o domínio (Registro.br, GoDaddy, Hostinger…), crie {x.dns?.length > 1 ? 'estes registros' : 'este registro'}:</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-[14px]"><thead className="text-[12.5px] text-ink-mute"><tr><th className="py-1 pr-3">Tipo</th><th className="pr-3">Nome</th><th>Valor</th></tr></thead>
                <tbody>{(x.dns ?? []).map((r: any, i: number) => <tr key={i} className="border-t border-line"><td className="num py-2 pr-3 font-bold">{r.type}</td><td className="num pr-3">{r.name}</td><td className="num break-all">{r.value} <CopyButton text={r.value} size="sm" variant="ghost" /></td></tr>)}</tbody></table></div>
              <p className="text-[13px] text-ink-mute">A mudança de DNS pode levar algumas horas para valer. Depois clique em “Verificar agora”.</p>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
