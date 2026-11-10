'use client';
import { use, useEffect, useState } from 'react';
import { get, post, api, ApiError } from '@/lib/api';
import { brl, dateTime, methodLabel } from '@/lib/format';
import { useMe, can } from '@/components/session';
import { Button, Card, Field, Skeleton, StatusBadge, Banner, Modal } from '@/components/ui';

export default function Pedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useMe();
  const [o, setO] = useState<any>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [refund, setRefund] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => get(`/v1/orders/${id}/detail`).then(setO);
  useEffect(() => { load(); }, [id]);
  if (!o) return <Skeleton className="h-96 w-full" />;
  const needOtp = o.total_cents > 100_000;
  return (
    <div className="space-y-4">
      <a href="/vendas" className="text-[14px] font-semibold text-action">← Vendas</a>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="num text-[24px] font-extrabold">#{o.code}</h1><p className="text-ink-mute">{dateTime(o.created_at)} · {methodLabel(o.method)}{o.installments > 1 ? ` em ${o.installments}x` : ''}{o.payment?.card_last4 ? ` · ${o.payment.card_brand} final ${o.payment.card_last4}` : ''}</p></div>
        <div className="flex items-center gap-2"><StatusBadge status={o.status} label={o.status_label} /><span className="num text-[22px] font-bold">{brl(o.total_cents)}</span></div>
      </div>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="font-extrabold">Linha do tempo</h2>
          <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">{o.timeline.map((t: any, i: number) => <li key={i} className="relative"><span className="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full bg-action" /><p className="font-semibold">{t.label}</p><p className="text-[13px] text-ink-mute">{dateTime(t.at)}</p></li>)}</ol>
        </Card>
        <Card>
          <h2 className="font-extrabold">Comprador</h2>
          <p className="mt-2 font-semibold">{o.customer.name}</p><p className="text-[14px] text-ink-soft">{o.customer.email}</p><p className="text-[14px] text-ink-soft">{o.customer.phone}</p><p className="num text-[13px] text-ink-mute">CPF {o.customer.document}</p>
          <div className="mt-4 flex flex-col gap-2">
            {o.customer.whatsapp_url && <a href={o.customer.whatsapp_url} target="_blank" className="inline-flex min-h-[44px] items-center justify-center rounded-ctl bg-[#25D366] font-bold text-white">Falar no WhatsApp</a>}
            {o.status === 'paid' && <Button variant="secondary" onClick={async () => { await post(`/v1/orders/${id}/resend-access`); setMsg({ tone: 'ok', text: 'Acesso reenviado por e-mail.' }); }}>Reenviar acesso</Button>}
            {o.status === 'paid' && can(me, 'orders.refund') && <Button variant="ghost" className="text-bad" onClick={() => setRefund(true)}>Reembolsar</Button>}
          </div>
        </Card>
        <Card>
          <h2 className="font-extrabold">Itens</h2>
          <ul className="mt-2 space-y-1">{o.items.map((i: any, k: number) => <li key={k} className="flex justify-between gap-3"><span>{i.product}{i.kind === 'bump' && <span className="text-[12.5px] text-ink-mute"> (oferta especial)</span>}</span><span className="num">{brl(i.price_cents)}</span></li>)}</ul>
          {o.discount_cents > 0 && <p className="mt-1 flex justify-between text-ok"><span>Cupom</span><span className="num">− {brl(o.discount_cents)}</span></p>}
          {o.interest_cents > 0 && <p className="mt-1 flex justify-between text-ink-mute"><span>Juros pagos pelo cliente</span><span className="num">{brl(o.interest_cents)}</span></p>}
        </Card>
        <Card>
          <h2 className="font-extrabold">Divisão da venda</h2>
          <ul className="mt-2 space-y-1">{o.splits.map((s: any, k: number) => <li key={k} className={`flex justify-between gap-3 ${s.type === 'producer' ? 'font-bold text-ok' : ''}`}><span>{s.label}</span><span className="num">{brl(s.amount_cents)}</span></li>)}</ul>
        </Card>
        <Card>
          <h2 className="font-extrabold">Origem</h2>
          {o.tracking && Object.keys(o.tracking).length ? <dl className="mt-2 space-y-1 text-[14px]">{Object.entries(o.tracking).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-mute">{k}</dt><dd className="truncate">{String(v)}</dd></div>)}</dl> : <p className="mt-2 text-ink-mute">Acesso direto</p>}
        </Card>
      </div>
      <Modal open={refund} onClose={() => setRefund(false)} title="Reembolsar esta venda" footer={<><Button variant="secondary" onClick={() => setRefund(false)}>Cancelar</Button><Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await api('POST', `/v1/orders/${id}/refund`, {}, { idem: true, otp: otp || undefined }); setRefund(false); setMsg({ tone: 'ok', text: 'Reembolso feito. O acesso do cliente foi encerrado.' }); load(); } catch (e) { setMsg({ tone: 'bad', text: (e as ApiError).title }); setRefund(false); } setBusy(false); }}>Confirmar reembolso</Button></>}>
        <p className="text-ink-soft">O cliente recebe <b className="num">{brl(o.total_cents)}</b> de volta e perde o acesso. A divisão é revertida para todos.</p>
        {needOtp && <Field className="mt-4" label="Código do aplicativo autenticador" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} mono hint="Pedimos o código para reembolsos acima de R$ 1.000." />}
      </Modal>
    </div>
  );
}
