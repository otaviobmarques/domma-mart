'use client';
import { useEffect, useState } from 'react';
import { get, post, api, ApiError } from '@/lib/api';
import { ago, dateTime } from '@/lib/format';
import { Button, Card, Field, Banner, Pill, Modal, CopyButton, cx } from '@/components/ui';

type Key = { id: string; name: string; hint: string; scopes: string[]; created_at: string; created_by?: string; last_used_at: string | null; revoked_at: string | null; calls_today: number };

/** Configurações › API: chaves de acesso para Zapier, n8n e sistemas próprios. */
export function ApiKeys({ setMsg }: { setMsg: (m: { tone: 'ok' | 'bad'; text: string } | null) => void }) {
  const [d, setD] = useState<{ scopes: Record<string, string>; keys: Key[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['sales:read']);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [revoke, setRevoke] = useState<Key | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => get('/v1/settings/api-keys').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const active = d.keys.filter(k => !k.revoked_at), old = d.keys.filter(k => k.revoked_at);

  async function create() {
    setBusy(true); setMsg(null);
    try { const r = await post<any>('/v1/settings/api-keys', { name, scopes }); setCreated({ key: r.key, name: r.name }); setOpen(false); setName(''); setScopes(['sales:read']); load(); }
    catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); setOpen(false); }
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-extrabold">Chaves da API</h2><Button onClick={() => setOpen(true)}>Criar chave</Button></div>
        <p className="text-[14.5px] text-ink-soft">Use uma chave para ligar a Domma Mart ao Zapier, ao n8n ou ao seu próprio sistema: consultar vendas e compradores, criar cupons e receber eventos. Cada chave tem só as permissões que você escolher.</p>
        <p className="text-[14px]"><a href="/desenvolvedores" target="_blank" className="font-semibold text-action">Documentação da API e guia do Zapier e n8n →</a></p>
      </Card>
      {created && <Banner tone="ok" action={<CopyButton text={created.key} label="Copiar chave" variant="primary" />}>
        <p className="font-bold">Chave “{created.name}” criada. Copie agora: por segurança, ela não aparece de novo.</p>
        <p className="num mt-1 break-all text-[13.5px]">{created.key}</p>
      </Banner>}
      <Card className="p-0">{active.length === 0 ? <p className="p-5 text-ink-mute">Nenhuma chave ativa.</p> : <ul className="divide-y divide-line">{active.map(k => (
        <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0"><p className="font-semibold">{k.name} <span className="num text-[13px] font-normal text-ink-mute">{k.hint}</span></p>
            <div className="mt-1 flex flex-wrap gap-1">{k.scopes.map(s => <Pill key={s}>{s}</Pill>)}</div>
            <p className="mt-1 text-[13px] text-ink-mute">Criada {dateTime(k.created_at)}{k.created_by ? ` por ${k.created_by}` : ''} · {k.last_used_at ? `usada ${ago(k.last_used_at)}` : 'nunca usada'} · <span className="num">{k.calls_today}</span> chamadas hoje</p></div>
          <Button size="sm" variant="ghost" className="text-bad" onClick={() => setRevoke(k)}>Revogar</Button>
        </li>))}</ul>}</Card>
      {old.length > 0 && <details className="text-[14px] text-ink-mute"><summary className="cursor-pointer font-semibold">Chaves revogadas ({old.length})</summary><ul className="mt-2 space-y-1">{old.map(k => <li key={k.id}>{k.name} <span className="num">{k.hint}</span> · revogada {dateTime(k.revoked_at!)}</li>)}</ul></details>}

      <Modal open={open} onClose={() => setOpen(false)} title="Nova chave da API" footer={<Button full loading={busy} disabled={name.trim().length < 2 || !scopes.length} onClick={create}>Criar chave</Button>}>
        <div className="space-y-3">
          <Field label="Nome (para você reconhecer)" value={name} onChange={e => setName(e.target.value.slice(0, 60))} placeholder="Ex.: Zapier — planilha de vendas" />
          <fieldset><legend className="mb-1 font-semibold">Permissões</legend>
            <p className="mb-2 text-[13.5px] text-ink-mute">Dê só o que a integração precisa.</p>
            {Object.entries(d.scopes).map(([s, l]) => <label key={s} className={cx('flex cursor-pointer items-start gap-2 rounded-ctl px-2 py-2 hover:bg-canvas', scopes.includes(s) && 'bg-action-soft/40')}>
              <input type="checkbox" className="mt-1 h-4 w-4" checked={scopes.includes(s)} onChange={e => setScopes(e.target.checked ? [...scopes, s] : scopes.filter(x => x !== s))} />
              <span><span className="num block text-[13.5px] font-semibold">{s}</span><span className="text-[14px] text-ink-soft">{l}</span></span></label>)}
          </fieldset>
          {scopes.includes('customers:read') && <Banner tone="warn">Esta permissão entrega telefone e CPF dos compradores. Use só em sistemas seus, protegidos, e de acordo com a LGPD.</Banner>}
        </div>
      </Modal>
      <Modal open={!!revoke} onClose={() => setRevoke(null)} title="Revogar chave" footer={<Button full variant="danger" onClick={async () => { await api('DELETE', `/v1/settings/api-keys/${revoke!.id}`); setRevoke(null); setMsg({ tone: 'ok', text: 'Chave revogada. Integrações que usavam esta chave param de funcionar agora.' }); load(); }}>Revogar agora</Button>}>
        <p className="text-[14.5px]">A chave <b>{revoke?.name}</b> para de funcionar na hora, e os webhooks que o Zapier ou o n8n criaram com ela são desligados. Não dá para desfazer.</p>
      </Modal>
    </div>
  );
}
