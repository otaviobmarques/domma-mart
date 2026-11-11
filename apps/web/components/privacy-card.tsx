'use client';
import { useEffect, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Button, Card, Textarea, Banner, Modal, Pill } from '@/components/ui';

type Req = { id: string; kind: 'deletion' | 'correction' | 'other'; status: 'pending' | 'scheduled' | 'done' | 'rejected'; created_at: string; retain_until: string | null; resolution: string | null };
const KIND: Record<Req['kind'], string> = { deletion: 'Exclusão dos dados', correction: 'Correção de dados', other: 'Outro pedido' };
const STATUS: Record<Req['status'], [string, 'warn' | 'action' | 'ok' | 'bad']> = { pending: ['Em análise', 'warn'], scheduled: ['Programado', 'action'], done: ['Concluído', 'ok'], rejected: ['Não atendido', 'bad'] };

/**
 * “Seus dados” (LGPD art. 18): baixar uma cópia, pedir correção ou exclusão.
 * `base` é /v1/customer/privacy (comprador) ou /v1/privacy (produtor/afiliado).
 */
export function PrivacyCard({ base, audience, onDeleted }: { base: string; audience: 'buyer' | 'seller'; onDeleted?: () => void }) {
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [open, setOpen] = useState<'deletion' | 'correction' | null>(null);
  const [details, setDetails] = useState('');
  const load = () => get<Req[]>(`${base}/requests`).then(setReqs).catch(() => setReqs([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [base]);

  async function download() {
    setBusy('export'); setMsg(null);
    try {
      const r = await fetch(`${base}/export`, { headers: { 'x-requested-with': 'domma' }, credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.status === 429 ? 'Muitos downloads seguidos. Tente de novo mais tarde.' : 'Não conseguimos gerar o arquivo agora.');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = 'meus-dados-domma-mart.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
    setBusy(null);
  }

  async function send(kind: 'deletion' | 'correction') {
    setBusy(kind); setMsg(null);
    try {
      const r = await post<Req>(`${base}/requests`, { kind, details: details.trim() || undefined });
      setOpen(null); setDetails('');
      setMsg({ tone: 'ok', text: r.resolution ?? (kind === 'deletion' ? 'Pedido de exclusão recebido. Nossa equipe confere a conta e responde por e-mail.' : 'Pedido de correção recebido. Respondemos por e-mail em até 15 dias.') });
      load();
      if (kind === 'deletion' && r.status === 'done') onDeleted?.();
    } catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); }
    setBusy(null);
  }

  const openDeletion = reqs?.some(r => r.kind === 'deletion' && (r.status === 'pending' || r.status === 'scheduled'));
  return (
    <Card>
      <h2 className="font-extrabold">Seus dados</h2>
      <p className="mt-1 text-[14px] text-ink-mute">Pela LGPD, você pode baixar uma cópia dos seus dados, pedir correção ou pedir a exclusão. Veja como tratamos seus dados na <a href="/privacidade" target="_blank" rel="noopener" className="underline">Política de Privacidade</a>.</p>
      {msg && <Banner tone={msg.tone} className="mt-3">{msg.text}</Banner>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === 'export'} onClick={download}>Baixar meus dados</Button>
        <Button variant="secondary" onClick={() => { setDetails(''); setOpen('correction'); }}>Pedir correção</Button>
        {!openDeletion && <Button variant="ghost" className="text-bad" onClick={() => { setDetails(''); setOpen('deletion'); }}>Pedir exclusão dos meus dados</Button>}
      </div>
      {reqs && reqs.length > 0 && <ul className="mt-4 divide-y divide-line text-[14px]">{reqs.map(r => (
        <li key={r.id} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{KIND[r.kind]}</span><Pill tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Pill></div>
          <p className="text-ink-mute">Pedido em {dateTime(r.created_at)}{r.retain_until ? ` · anonimização em ${new Date(r.retain_until).toLocaleDateString('pt-BR')}` : ''}</p>
          {r.resolution && <p className="mt-1 text-ink-soft">{r.resolution}</p>}
        </li>
      ))}</ul>}

      <Modal open={open === 'correction'} onClose={() => setOpen(null)} title="Pedir correção de dados"
        footer={<Button full loading={busy === 'correction'} disabled={details.trim().length < 10} onClick={() => send('correction')}>Enviar pedido</Button>}>
        <Textarea label="O que precisa ser corrigido?" value={details} onChange={e => setDetails(e.target.value)} hint="Ex.: meu nome está escrito errado; o certo é …" />
      </Modal>

      <Modal open={open === 'deletion'} onClose={() => setOpen(null)} title="Pedir exclusão dos meus dados"
        footer={<Button full variant="danger" loading={busy === 'deletion'} onClick={() => send('deletion')}>Confirmar pedido de exclusão</Button>}>
        {audience === 'buyer' ? <div className="space-y-2 text-[14.5px] text-ink-soft">
          <p>Na hora, apagamos seus <b>cartões guardados</b>, paramos as <b>mensagens</b> e cancelamos a renovação de assinaturas (o acesso vai até o fim do período pago).</p>
          <p>Se você tem compras pagas, a lei manda guardar os dados delas por 5 anos (fiscal e defesa do consumidor). Depois disso, apagamos tudo automaticamente. Sem compras pagas, apagamos tudo agora.</p>
          <p>Você continua com acesso aos produtos que já comprou enquanto os dados estiverem guardados.</p>
        </div> : <div className="space-y-2 text-[14.5px] text-ink-soft">
          <p>Excluir os seus dados significa <b>encerrar a sua conta</b>: o acesso ao painel é bloqueado e seus produtos saem do ar.</p>
          <p>Antes, a conta precisa estar sem saldo, sem valores a liberar, sem contestações e sem saques em andamento. Nossa equipe confere e responde por e-mail.</p>
          <p>Dados de identidade e financeiros ficam guardados por 5 anos depois do encerramento (Lei 9.613/1998, prevenção à lavagem de dinheiro) e depois são anonimizados.</p>
        </div>}
        <Textarea className="mt-3" label="Quer contar o motivo? (opcional)" value={details} onChange={e => setDetails(e.target.value)} />
      </Modal>
    </Card>
  );
}
