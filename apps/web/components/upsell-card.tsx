'use client';
import { useEffect, useRef, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';
import { track } from '@/lib/pixels';
import { Button, Card, Banner, Select } from '@/components/ui';

type Step = 'upsell' | 'downsell';
type Accepted = { step: Step; order_id: string; code: string; status: string; method: 'card' | 'pix'; total_cents: number; next: { type: string; url: string } | null };
export type FunnelState = {
  step: Step | null; accepted: Accepted[]; expires_at?: string; declined?: { title: string };
  offer: null | {
    offer_id: string; price_cents: number; guarantee_days: number; headline: string; text: string | null;
    product: { name: string; type: string; cover_url: string | null; description: string | null };
    methods: ('card' | 'pix')[]; card: { brand: string; last4: string } | null;
    installment_options: { n: number; installment_cents: number; total_cents: number; interest_free: boolean }[];
  };
};

const BRAND: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', elo: 'Elo', amex: 'Amex', hipercard: 'Hipercard' };

/** Oferta com 1 clique na página de obrigado: cobra o mesmo cartão (ou gera um Pix) sem pedir os dados de novo. */
export function UpsellCard({ orderId, t, initial, onDone }: { orderId: string; t: string; initial: FunnelState; onDone?: () => void }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<'yes' | 'pix' | 'no' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(1);
  const [left, setLeft] = useState(() => (initial.expires_at ? new Date(initial.expires_at).getTime() - Date.now() : 0));
  const tracked = useRef(new Set(initial.accepted.filter(a => a.status === 'paid').map(a => a.order_id)));
  const url = `/v1/orders/${orderId}/upsell?t=${encodeURIComponent(t)}`;

  // cartão: a confirmação chega por webhook em instantes
  const pending = s.accepted.some(a => a.method === 'card' && (a.status === 'pending' || a.status === 'created'));
  useEffect(() => {
    if (!pending) return;
    const x = setTimeout(() => get<FunnelState>(url).then(setS).catch(() => {}), 1500);
    return () => clearTimeout(x);
  }, [s, pending, url]);
  useEffect(() => {
    for (const a of s.accepted) if (a.status === 'paid' && !tracked.current.has(a.order_id)) { tracked.current.add(a.order_id); track('Purchase', { value: a.total_cents / 100, eventId: `purchase_${a.order_id}` }); }
    if (!s.step && !pending) onDone?.();
    // eslint-disable-next-line
  }, [s, pending]);
  useEffect(() => {
    if (!s.expires_at) return;
    const x = setInterval(() => setLeft(new Date(s.expires_at!).getTime() - Date.now()), 1000);
    return () => clearInterval(x);
  }, [s.expires_at]);

  async function decide(accept: boolean, method?: 'card' | 'pix') {
    if (!s.step) return;
    setBusy(!accept ? 'no' : method === 'pix' ? 'pix' : 'yes'); setErr(null);
    try {
      const r = await post<FunnelState>(url, { step: s.step, accept, method, installments: method === 'card' ? n : undefined });
      const made = r.accepted.find(a => a.step === s.step);
      if (accept && made?.method === 'pix' && made.next?.type === 'pix' && made.status === 'pending') { location.href = made.next.url; return; }
      setS(r); setN(1);
      if (r.declined) setErr(r.declined.title);
    } catch (e) {
      const a = e as ApiError;
      setErr(Object.values(a.fields ?? {})[0] ?? a.title);
      get<FunnelState>(url).then(setS).catch(() => {});
    }
    setBusy(null);
  }

  const done = s.accepted.filter(a => a.status === 'paid' || (a.method === 'card' && a.status === 'pending'));
  const o = s.offer;
  const expired = s.step && left <= 0;
  if (!o && !done.length && !err) return null;

  return (
    <div className="space-y-4">
      {done.map(a => (
        <Card key={a.order_id} className="border-ok">
          {a.status === 'paid'
            ? <><p className="font-extrabold text-ok">Compra adicional aprovada</p><p className="mt-1 text-[14.5px] text-ink-soft">Pedido #{a.code} · {brl(a.total_cents)}. O acesso vai para o mesmo e-mail.</p></>
            : <p className="font-semibold text-ink-soft">Confirmando a compra adicional…</p>}
        </Card>
      ))}
      {err && <Banner tone="bad">{err}</Banner>}
      {o && s.step && !expired && (
        <Card className="border-2 border-action">
          <p className="text-[13px] font-bold uppercase tracking-wide text-action">{s.step === 'upsell' ? 'Oferta especial para você' : 'Uma última oferta'}</p>
          <h2 className="mt-1 text-[22px] font-extrabold leading-tight">{o.headline}</h2>
          {o.product.cover_url && <img src={o.product.cover_url} alt="" className="mt-4 aspect-video w-full rounded-ctl object-cover" />}
          <p className="mt-3 font-bold">{o.product.name}</p>
          {(o.text || o.product.description) && <p className="mt-1 whitespace-pre-line text-[15px] text-ink-soft">{o.text || o.product.description}</p>}
          <p className="mt-4 text-[26px] font-extrabold num">{brl(o.price_cents)}</p>
          {o.guarantee_days > 0 && <p className="text-[14px] text-ink-mute">Garantia de {o.guarantee_days} dias: não gostou, pede o dinheiro de volta.</p>}

          <div className="mt-4 space-y-3">
            {o.card && <>
              {o.installment_options.length > 1 && (
                <Select label="Parcelas" value={n} onChange={e => setN(Number(e.target.value))}>
                  {o.installment_options.map(i => <option key={i.n} value={i.n}>{i.n}x de {brl(i.installment_cents)}{i.n > 1 ? (i.interest_free ? ' sem juros' : ` (total ${brl(i.total_cents)})`) : ''}</option>)}
                </Select>
              )}
              <Button size="xl" full loading={busy === 'yes'} disabled={!!busy} onClick={() => decide(true, 'card')}>
                Sim, quero por {n > 1 ? `${n}x de ${brl(o.installment_options[n - 1]?.installment_cents)}` : brl(o.price_cents)}
              </Button>
              <p className="text-center text-[13.5px] text-ink-mute">Cobrado no mesmo cartão {BRAND[o.card.brand] ?? o.card.brand} final {o.card.last4}. Você não precisa digitar nada.</p>
            </>}
            {o.methods.includes('pix') && (
              <Button size={o.card ? 'md' : 'xl'} variant={o.card ? 'ghost' : 'primary'} full loading={busy === 'pix'} disabled={!!busy} onClick={() => decide(true, 'pix')}>
                {o.card ? 'Prefiro pagar com Pix' : `Sim, quero por ${brl(o.price_cents)} no Pix`}
              </Button>
            )}
            <button type="button" className="w-full py-2 text-[14.5px] font-semibold text-ink-mute underline disabled:opacity-50" disabled={!!busy} onClick={() => decide(false)}>
              Não, obrigado
            </button>
          </div>
          {left > 0 && <p className="mt-2 text-center text-[13px] text-ink-mute">Disponível só nesta página por mais <span className="num">{Math.floor(left / 60000)}:{String(Math.floor(left / 1000) % 60).padStart(2, '0')}</span></p>}
        </Card>
      )}
    </div>
  );
}
