'use client';
import { useEffect, useState } from 'react';
import { get, post, api, ApiError } from '@/lib/api';
import { brl, shortDate, methodLabel, maskDoc, digits } from '@/lib/format';
import { Button, Card, Skeleton, Banner, Modal, Initials, Logo, Pill, Field, Select } from '@/components/ui';

type P = any;
const REASONS = [['prefer_not_say', 'Prefiro não dizer'], ['not_expected', 'Não era o que eu esperava'], ['bought_by_mistake', 'Comprei por engano'], ['access_problem', 'Tive problema para acessar']];

export default function MinhasCompras() {
  const [d, setD] = useState<P | null>(null);
  const [refund, setRefund] = useState<P | null>(null);
  const [reason, setReason] = useState('prefer_not_say');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [cancelSub, setCancelSub] = useState<P | null>(null);
  const [cpfOpen, setCpfOpen] = useState(false);
  const [cpf, setCpf] = useState('');
  const [cpfMsg, setCpfMsg] = useState<string | null>(null);

  const load = () => get('/v1/customer/purchases').then(setD).catch((e: ApiError) => { if (e.status === 401) location.href = '/minhas-compras/entrar'; });
  useEffect(() => { load(); }, []);

  async function confirmRefund() {
    setBusy(true);
    try {
      const r = await api<any>('POST', `/v1/customer/orders/${refund.order_id}/refund`, { reason }, { idem: true });
      setFlash(r.method === 'pix' ? 'Reembolso pedido. Como você pagou com Pix, o dinheiro volta para a sua conta em até 1 dia útil.' : r.method === 'card' ? 'Reembolso pedido. O estorno aparece na fatura do seu cartão em até 2 faturas, conforme o banco.' : 'Reembolso pedido. Informe uma chave Pix no seu CPF para receber o valor.');
      setRefund(null); load();
    } catch (e) { setFlash((e as ApiError).title); setRefund(null); }
    setBusy(false);
  }

  if (!d) return <Shell><div className="space-y-3"><Skeleton className="h-8 w-40" />{[0, 1].map(i => <Skeleton key={i} className="h-36 w-full" />)}</div></Shell>;
  return (
    <Shell onLogout={async () => { await post('/v1/customer/auth/logout'); location.href = '/minhas-compras/entrar'; }}>
      <h1 className="text-[24px] font-extrabold">Olá, {d.first_name}</h1>
      {flash && <Banner tone="ok" className="mt-4">{flash}</Banner>}

      {d.pending.map((p: P) => (
        <div key={p.order_id} className="mt-4 rounded-card border-2 border-warn-line bg-warn-soft/60 p-4">
          <p className="text-[12.5px] font-extrabold uppercase tracking-wide text-[#7A4500]">Falta pagar</p>
          <p className="mt-1 font-bold">{p.product}</p>
          <p className="text-[14px] text-ink-soft"><span className="num">{brl(p.total_cents)}</span> · {methodLabel(p.method)} · vence {new Date(p.due_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
          <a href={p.pay_url} className="mt-3 inline-flex min-h-[44px] items-center rounded-ctl bg-action px-4 font-bold text-white">Pagar agora</a>
        </div>
      ))}

      <div className="mt-5 space-y-4">
        {d.purchases.length === 0 && <Card><p className="font-bold">Você ainda não tem compras com este e-mail.</p><Button variant="secondary" className="mt-3" onClick={() => setCpfOpen(true)}>Buscar pelo CPF</Button></Card>}
        {d.purchases.map((p: P) => {
          const refunded = p.status === 'refunded';
          const requested = p.status === 'refund_requested' || (p.refund && p.refund.status === 'processing');
          const active = p.status === 'paid';
          const cta = p.product.type === 'file' ? 'Baixar arquivo' : p.product.type === 'service' ? 'Agendar horário' : 'Acessar';
          const href = p.product.type === 'service' ? p.product.service_url : `/curso/${p.product.id}`;
          return (
            <Card key={p.order_id}>
              <div className="flex gap-4">
                <Initials name={p.product.name} src={p.product.cover_url} size={64} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-tight">{p.product.name}</p>
                  <p className="text-[14px] text-ink-mute">{shortDate(p.paid_at ?? p.created_at)} · {methodLabel(p.method)} · <span className="num">{brl(p.total_cents)}</span></p>
                  {p.bumps.length > 0 && <p className="text-[13.5px] text-ink-mute">+ {p.bumps.map((b: P) => b.name).join(', ')}</p>}
                  <div className="mt-1.5">
                    {refunded && <Pill>Reembolsado em {shortDate(p.refunded_at)}</Pill>}
                    {requested && !refunded && <Pill tone="warn">Reembolso em andamento</Pill>}
                    {p.status === 'chargeback' && <Pill tone="bad">Em análise</Pill>}
                    {active && p.in_guarantee && <span className="text-[13.5px] font-semibold text-ok">Garantia até {shortDate(p.guarantee_ends_at)}</span>}
                  </div>
                </div>
              </div>
              {p.subscription && (
                <div className={`mt-4 rounded-ctl p-3 text-[14px] ${p.subscription.status === 'past_due' ? 'bg-bad-soft' : 'bg-canvas'}`}>
                  {p.subscription.status === 'past_due' && <p className="mb-1 font-bold text-bad">Não conseguimos cobrar seu cartão. Atualize para não perder o acesso.</p>}
                  <p><span className="num">{brl(p.subscription.price_cents)}</span> · cartão {p.subscription.card_brand} final {p.subscription.card_last4}</p>
                  <p className="text-ink-mute">{p.subscription.cancel_at_period_end ? `Cancelada — acesso até ${shortDate(p.subscription.current_period_end)}` : p.subscription.next_charge_at ? `Próxima cobrança em ${shortDate(p.subscription.next_charge_at)}` : ''}</p>
                  {!p.subscription.cancel_at_period_end && p.subscription.status !== 'canceled' && <button className="mt-2 min-h-[36px] font-semibold text-bad underline" onClick={() => setCancelSub(p.subscription)}>Cancelar assinatura</button>}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {active && !requested && <a href={href ?? '#'} className="inline-flex min-h-[44px] items-center rounded-ctl bg-action px-5 font-bold text-white">{cta}</a>}
                {(active || refunded) && <a href={`/v1/customer/orders/${p.order_id}/receipt.pdf`} target="_blank" className="inline-flex min-h-[44px] items-center px-3 font-semibold text-action">Ver recibo</a>}
                <a href={p.seller.whatsapp ? `https://wa.me/${digits(p.seller.whatsapp)}` : `mailto:${p.seller.email}`} target="_blank" className="inline-flex min-h-[44px] items-center px-3 font-semibold text-action">Falar com o produtor</a>
                {active && p.in_guarantee && !requested && <button onClick={() => { setReason('prefer_not_say'); setRefund(p); }} className="ml-auto inline-flex min-h-[44px] items-center px-3 font-semibold text-ink-mute underline">Pedir reembolso</button>}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 rounded-card border border-dashed border-line bg-white/70 p-4 text-[14.5px]">
        Não achou uma compra? <button className="font-bold text-action underline" onClick={() => setCpfOpen(true)}>Buscar pelo CPF</button>
      </div>

      <Modal open={!!refund} onClose={() => setRefund(null)} title="Pedir reembolso" footer={<><Button variant="secondary" onClick={() => setRefund(null)}>Manter compra</Button><Button variant="danger" loading={busy} onClick={confirmRefund}>Confirmar reembolso</Button></>}>
        {refund && <>
          <p className="text-ink-soft">Você vai receber de volta <b className="num">{brl(refund.total_cents)}</b> de <b>{refund.product.name}</b>. O acesso ao conteúdo é encerrado.</p>
          <Select label="Motivo (opcional)" className="mt-4" value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </>}
      </Modal>
      <Modal open={!!cancelSub} onClose={() => setCancelSub(null)} title="Cancelar assinatura" footer={<><Button variant="secondary" onClick={() => setCancelSub(null)}>Manter assinatura</Button><Button variant="danger" onClick={async () => { await post(`/v1/customer/subscriptions/${cancelSub.id}/cancel`); setCancelSub(null); load(); }}>Cancelar</Button></>}>
        {cancelSub && <p className="text-ink-soft">Seu acesso continua até <b>{shortDate(cancelSub.current_period_end)}</b>. Não haverá novas cobranças.</p>}
      </Modal>
      <Modal open={cpfOpen} onClose={() => { setCpfOpen(false); setCpfMsg(null); }} title="Buscar pelo CPF">
        <p className="text-ink-soft">Enviamos um link de acesso para os e-mails ligados a este CPF.</p>
        <Field label="Seu CPF" inputMode="numeric" value={cpf} onChange={e => setCpf(maskDoc(e.target.value))} className="mt-4" big />
        {cpfMsg && <Banner tone="info" className="mt-3">{cpfMsg}</Banner>}
        <Button full className="mt-4" onClick={async () => { try { const r = await post<any>('/v1/customer/auth/by-document', { document: cpf }); setCpfMsg(r.hints.length ? `Enviamos um link para: ${r.hints.join(', ')}` : 'Não encontramos compras com este CPF.'); } catch (e) { setCpfMsg((e as ApiError).title); } }}>Enviar link</Button>
      </Modal>
    </Shell>
  );
}

function Shell({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 pb-12 pt-5">
      <header className="mb-6 flex items-center justify-between"><Logo className="text-[15px]" />{onLogout && <div className="flex gap-1"><a href="/cursos" className="inline-flex min-h-[44px] items-center px-3 font-semibold text-action">Meus cursos</a><button onClick={onLogout} className="min-h-[44px] px-3 font-semibold text-ink-mute">Sair</button></div>}</header>
      {children}
    </main>
  );
}
