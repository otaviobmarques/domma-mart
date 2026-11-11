'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, api, ApiError, uuid } from '@/lib/api';
import { brl, maskDoc, maskPhone, digits, isValidCPF, isValidCNPJ, emailSuggestion } from '@/lib/format';
import { tokenizeCard, brandOf } from '@/lib/tokenizer';
import { deviceId } from '@/lib/device';
import { run3DS, needs3DS, type BillingAddress } from '@/lib/threeds';
import { loadPixels, track } from '@/lib/pixels';
import { Button, Field, Skeleton, Banner, Initials, cx, Logo } from '@/components/ui';

type Offer = {
  offer_id: string; slug: string; price_cents: number; methods: string[]; guarantee_days: number; billing_type: string; interval: string | null;
  installment_interest: 'buyer' | 'producer'; max_installments: number; installment_options: { n: number; installment_cents: number; total_cents: number; interest_free: boolean }[];
  product: { name: string; type: string; cover_url: string | null; description: string | null }; seller: { name: string; whatsapp: string | null };
  theme: { color?: string; logo_url?: string; banner_url?: string; testimonials?: { name: string; text: string }[]; countdown_minutes?: number; pixels?: any };
  bumps: { offer_id: string; name: string; headline: string | null; price_cents: number; cover_url: string | null }[]; gateway: string; gateway_public_key?: string | null; three_ds?: { scriptUrl: string } | null; one_click?: boolean;
};

const ORDER = ['pix', 'card', 'boleto'] as const;
const INTERVAL: Record<string, string> = { month: 'por mês', quarter: 'por trimestre', semester: 'por semestre', year: 'por ano' };

/** Tabela Price 2,99% a.m. só para exibição; o valor cobrado é sempre calculado no servidor (RN-01). */
function plan(principal: number, n: number, mode: 'buyer' | 'producer') {
  if (n <= 1) return { inst: principal, total: principal, free: true };
  if (mode === 'producer') return { inst: Math.round(principal / n), total: principal, free: true };
  const i = 0.0299, p = Math.pow(1 + i, n);
  const inst = Math.round((principal * i * p) / (p - 1));
  return { inst, total: inst * n, free: false };
}

export default function Checkout({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  const qs = useMemo(() => (typeof window !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()), []);

  const [name, setName] = useState('');
  const [email, setEmail] = useState(qs.get('email') ?? '');
  const [phone, setPhone] = useState('');
  const [doc, setDoc] = useState('');
  const [method, setMethod] = useState<'pix' | 'card' | 'boleto'>('pix');
  const [card, setCard] = useState({ number: '', exp: '', cvv: '', name: '' });
  const [installments, setInstallments] = useState(1);
  // compra com 1 clique (cartão guardado, confirmado por código no e-mail)
  const [saveCard, setSaveCard] = useState(false);
  const [oc, setOc] = useState<{ step: 'off' | 'code' | 'ready'; code: string; token?: string; cards?: { id: string; brand: string; last4: string }[]; cardId?: string; firstName?: string; err?: string; busy?: boolean }>({ step: 'off', code: '' });
  const ocReady = oc.step === 'ready' && !!oc.token && !!oc.cardId;
  // endereço de cobrança, pedido só quando o banco confirma a compra (3-D Secure)
  const [bill, setBill] = useState<BillingAddress>({ zip: '', street: '', number: '', complement: '', district: '', city: '', state: '' });
  const [bumps, setBumps] = useState<string[]>([]);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount_cents: number; kind: string; value: number } | null>(null);
  const [couponErr, setCouponErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<{ text: string; offerPix?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<string | null>(null);
  const idemRef = useRef<string>(uuid());
  const formRef = useRef<HTMLFormElement>(null);
  const tracked = useRef(false);

  useEffect(() => {
    const track: Record<string, string> = {};
    qs.forEach((v, k) => { if (/^(utm_|src$|fbclid$|gclid$)/.test(k)) track[k] = v; });
    get<Offer>(`/v1/public/offers/${slug}?${new URLSearchParams(track)}`)
      .then(o => { setOffer(o); setMethod((ORDER.find(m => o.methods.includes(m)) ?? 'pix') as any); loadPixels(o.theme?.pixels); })
      .catch(e => setLoadErr(e));
  }, [slug, qs]);

  // cupom vindo na URL é aplicado automaticamente
  useEffect(() => { const c = qs.get('cupom'); if (offer && c) { setCouponInput(c.toUpperCase()); applyCoupon(c); } /* eslint-disable-next-line */ }, [offer]);

  const bumpTotal = offer ? offer.bumps.filter(b => bumps.includes(b.offer_id)).reduce((s, b) => s + b.price_cents, 0) : 0;
  const discount = coupon?.discount_cents ?? 0;
  const base = offer ? offer.price_cents - discount + bumpTotal : 0;
  const maxN = useMemo(() => {
    if (!offer) return 1;
    let best = 1;
    for (let n = 2; n <= Math.min(12, offer.max_installments); n++) if (plan(base, n, offer.installment_interest).inst >= 500) best = n;
    return best;
  }, [offer, base]);
  useEffect(() => { if (installments > maxN) setInstallments(maxN); }, [maxN, installments]);
  const p = offer ? plan(base, method === 'card' ? installments : 1, offer.installment_interest) : { total: 0, inst: 0, free: true };
  const headline = offer ? plan(offer.price_cents, offer.max_installments, offer.installment_interest) : null;
  const color = offer?.theme?.color || '#5B3FE6';

  async function applyCoupon(code = couponInput) {
    if (!offer || !code) return;
    setCouponErr(null);
    try { setCoupon(await post('/v1/public/coupons/validate', { offer_id: offer.offer_id, code: code.toUpperCase() })); }
    catch (e) { setCoupon(null); setCouponErr((e as ApiError).title || 'Cupom inválido ou expirado.'); }
  }

  async function ocStart() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErrors({ email: 'Digite seu e-mail para receber o código.' }); focusFirst({ email: 'x' }); return; }
    setOc({ ...oc, step: 'code', busy: true, err: undefined });
    try { await post('/v1/public/one-click/start', { email: email.trim().toLowerCase() }); setOc(o => ({ ...o, busy: false })); }
    catch (e) { setOc(o => ({ ...o, busy: false, err: (e as ApiError).title })); }
  }
  async function ocVerify() {
    setOc(o => ({ ...o, busy: true, err: undefined }));
    try {
      const r = await post<any>('/v1/public/one-click/verify', { email: email.trim().toLowerCase(), code: oc.code });
      if (!r.cards.length) { setOc({ step: 'off', code: '', err: 'Não encontramos cartão guardado neste e-mail.' }); return; }
      setOc({ step: 'ready', code: '', token: r.token, cards: r.cards, cardId: r.cards[0].id, firstName: r.first_name });
      setErrors({});
    } catch (e) { setOc(o => ({ ...o, busy: false, err: (e as ApiError).title })); }
  }
  async function lookupZip(z: string) {
    if (digits(z).length !== 8) return;
    try { const j = await (await fetch(`https://viacep.com.br/ws/${digits(z)}/json/`)).json(); if (!j.erro) setBill(b => ({ ...b, street: b.street || j.logradouro || '', district: b.district || j.bairro || '', city: j.localidade || b.city, state: j.uf || b.state })); } catch { /* preenchimento manual */ }
  }

  function validate() {
    const e: Record<string, string> = {};
    if (method === 'card' && ocReady) return e; // dados e cartão já confirmados pelo código do e-mail
    const n = name.trim();
    if (n.length < 3 || n.split(/\s+/).length < 2) e.name = 'Digite seu nome completo.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = 'Confira seu e-mail. Ele parece estar incompleto.';
    const ph = digits(phone);
    if (ph.length !== 11 || ph[2] !== '9') e.phone = 'Confira o número com DDD.';
    const d = digits(doc);
    if (!(d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false)) e.doc = 'CPF inválido. Confira os números.';
    if (method === 'card') {
      if (digits(card.number).length < 13) e.card_number = 'Confira o número do cartão.';
      if (!/^\d{2}\/\d{2}$/.test(card.exp)) e.card_exp = 'Use o formato MM/AA.';
      if (!/^\d{3,4}$/.test(card.cvv)) e.card_cvv = 'Confira o CVV.';
      if (offer?.three_ds && needs3DS(brandOf(card.number))) {
        if (digits(bill.zip).length !== 8) e.bill_zip = 'CEP com 8 números.';
        if (!bill.number.trim()) e.bill_number = 'Número (ou S/N).';
        if (bill.street.trim().length < 2) e.bill_street = 'Informe a rua.';
        if (bill.district.trim().length < 2) e.bill_district = 'Informe o bairro.';
        if (bill.city.trim().length < 2) e.bill_city = 'Informe a cidade.';
        if (!/^[A-Za-z]{2}$/.test(bill.state)) e.bill_state = 'UF com 2 letras.';
      }
    }
    return e;
  }

  function focusFirst(e: Record<string, string>) {
    const order = ['name', 'email', 'phone', 'doc', 'card_number', 'card_exp', 'card_cvv', 'bill_zip', 'bill_number', 'bill_street', 'bill_district', 'bill_city', 'bill_state'];
    const k = order.find(x => e[x]);
    if (k) setTimeout(() => (document.getElementById(`f-${k}`) as HTMLInputElement | null)?.focus(), 0);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!offer || busy) return;
    setAlert(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) { focusFirst(e); return; }
    setBusy(true);
    try {
      let card_token: string | undefined;
      let three_ds: { transaction_id: string; status: string } | undefined;
      const withBill = method === 'card' && !ocReady && !!offer.three_ds && needs3DS(brandOf(card.number));
      if (method === 'card' && !ocReady) {
        if (withBill) {
          // o banco confirma a compra antes do pagamento (pode abrir uma janela do app ou SMS)
          try {
            const { token } = await post<{ token: string }>('/v1/public/3ds-token', {});
            const [mm, yy] = card.exp.split('/').map(Number);
            three_ds = await run3DS({ scriptUrl: offer.three_ds!.scriptUrl, token, amountCents: p.total, card: { number: card.number, name, mm, yy }, customer: { name: name.trim(), email: email.trim(), phone, document: doc }, billing: bill });
          } catch (err) { setAlert({ text: (err as Error).message, offerPix: offer.methods.includes('pix') }); setBusy(false); return; }
        }
        try { card_token = (await tokenizeCard({ ...card, name }, { provider: offer.gateway, publicKey: offer.gateway_public_key })).token; }
        catch (err) { setErrors({ card_number: (err as Error).message }); focusFirst({ card_number: 'x' }); setBusy(false); return; }
        track('AddPaymentInfo', { value: p.total / 100 });
      }
      const tracking: Record<string, string> = {};
      qs.forEach((v, k) => { if (/^(utm_|src$|fbclid$|gclid$)/.test(k)) tracking[k] = v.slice(0, 300); });
      if (document.referrer) tracking.referrer = document.referrer.slice(0, 300);
      const r = await api<any>('POST', `/v1/checkout/${offer.offer_id}/orders`, {
        customer: method === 'card' && ocReady ? undefined : { name: name.trim(), email: email.trim().toLowerCase(), phone, document: digits(doc) },
        one_click: method === 'card' && ocReady ? { token: oc.token, card_id: oc.cardId } : undefined,
        save_card: method === 'card' && !ocReady && saveCard ? true : undefined,
        billing_address: withBill ? { ...bill, zip: digits(bill.zip), state: bill.state.toUpperCase(), complement: bill.complement || undefined } : undefined,
        three_ds,
        method, installments: method === 'card' ? installments : 1, card_token, bump_offer_ids: bumps,
        coupon_code: coupon?.code, tracking, affiliate_code: qs.get('ref') ?? undefined,
        device_fingerprint: await deviceId().catch(() => undefined),
        card_bin: method === 'card' && !ocReady ? digits(card.number).slice(0, 6) : undefined,
      }, { idem: idemRef.current });
      location.href = r.next.url;
    } catch (err) {
      const x = err as ApiError;
      idemRef.current = uuid(); // nova tentativa = nova chave
      if (x.fields && Object.keys(x.fields).length) {
        const map: Record<string, string> = { 'customer.name': 'name', 'customer.email': 'email', 'customer.phone': 'phone', 'customer.document': 'doc', coupon_code: 'coupon' };
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(x.fields)) { if (map[k] === 'coupon') setCouponErr(v); else fe[map[k] ?? k] = v; }
        setErrors(fe); focusFirst(fe);
      }
      if (x.code === 'AUTH_LINK_EXPIRED' && ocReady) { setOc({ step: 'off', code: '', err: x.title }); setBusy(false); return; }
      if (x.status === 402) setAlert({ text: x.title, offerPix: offer.methods.includes('pix') });
      else if (x.code === 'RATE_LIMITED') setAlert({ text: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.' });
      else if (!x.fields || !Object.keys(x.fields).length) setAlert({ text: x.title });
      setBusy(false);
    }
  }

  function onEmailBlur() {
    const s = emailSuggestion(email.trim());
    setSuggest(s);
    if (offer && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) post('/v1/public/checkout-leads', { offer_id: offer.offer_id, email: email.trim().toLowerCase(), name: name.trim() || undefined, phone: digits(phone).length === 11 ? phone : undefined }).catch(() => {});
    if (!tracked.current) { tracked.current = true; track('InitiateCheckout', { value: (offer?.price_cents ?? 0) / 100 }); }
  }

  if (loadErr) {
    const ended = loadErr.data?.ended;
    return (
      <Shell>
        <div className="rounded-card border border-line bg-white p-8 text-center shadow-card">
          <p className="text-[20px] font-extrabold">{loadErr.code === 'OFFER_SOLD_OUT' ? 'As vagas desta oferta acabaram.' : ended ? loadErr.title : 'Esta oferta não está mais disponível.'}</p>
          <p className="mt-2 text-ink-mute">Fale com quem te indicou ou com o vendedor para saber das próximas turmas.</p>
          {loadErr.data?.seller_whatsapp && <a className="mt-6 inline-flex min-h-[48px] items-center rounded-ctl bg-action px-5 font-bold text-white" href={`https://wa.me/${digits(loadErr.data.seller_whatsapp)}`}>Falar com o vendedor</a>}
        </div>
      </Shell>
    );
  }

  if (!offer) {
    return (
      <Shell>
        <div className="space-y-4 rounded-card border border-line bg-white p-5 shadow-card">
          <div className="flex gap-4"><Skeleton className="h-[72px] w-[72px]" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-6 w-1/2" /></div></div>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[52px] w-full" />)}
          <Skeleton className="h-[60px] w-full" />
        </div>
      </Shell>
    );
  }

  const ocCard = ocReady ? oc.cards!.find(k => k.id === oc.cardId) : null;
  const btnLabel = method === 'pix' ? 'Pagar com Pix' : method === 'card' ? (ocCard ? `Comprar com ${ocCard.brand.charAt(0).toUpperCase()}${ocCard.brand.slice(1)} •••• ${ocCard.last4}` : 'Comprar agora') : 'Gerar boleto';
  const show3DSBill = method === 'card' && !ocReady && !!offer.three_ds && needs3DS(brandOf(card.number));
  const brand = brandOf(card.number);
  return (
    <Shell color={color} logo={offer.theme.logo_url} countdown={offer.theme.countdown_minutes}>
      {offer.theme.banner_url && <img src={offer.theme.banner_url} alt="" className="mb-4 w-full rounded-card object-cover" />}
      <form ref={formRef} onSubmit={submit} noValidate className="rounded-card border border-line bg-white p-5 shadow-card sm:p-6" style={{ ['--brand' as any]: color }}>
        {/* Cabeçalho do produto */}
        <div className="flex gap-4">
          <Initials name={offer.product.name} src={offer.product.cover_url} size={72} />
          <div className="min-w-0">
            <h1 className="text-[18px] font-extrabold leading-tight">{offer.product.name}</h1>
            <p className="text-[14px] text-ink-mute">por {offer.seller.name}</p>
            <p className="mt-1"><span className="num text-[22px] font-bold">{brl(offer.price_cents)}</span>{offer.billing_type === 'subscription' && <span className="ml-1 text-ink-mute">{INTERVAL[offer.interval ?? 'month']}</span>}</p>
            {offer.max_installments > 1 && headline && <p className="text-[14px] text-ink-mute">ou {offer.max_installments}x de <span className="num">{brl(headline.inst)}</span></p>}
          </div>
        </div>

 {method === 'card' && ocReady ? (
          <div className="mt-6 flex items-center justify-between gap-2 rounded-ctl bg-canvas px-4 py-3 text-[15px]">
            <span>Comprando como <b>{oc.firstName}</b> ({email.trim().toLowerCase()})</span>
            <button type="button" className="min-h-[44px] font-semibold text-action underline" onClick={() => setOc({ step: 'off', code: '' })}>Trocar</button>
          </div>
        ) : <div className="mt-6 space-y-4">
          <Field id="f-name" label="Seu nome" autoComplete="name" value={name} onChange={e => setName(e.target.value)} error={errors.name} big maxLength={120} placeholder="Nome e sobrenome" />
          <div>
            <Field id="f-email" label="Seu e-mail" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => { setEmail(e.target.value); setSuggest(null); }} onBlur={onEmailBlur} error={errors.email} big hint="Seu acesso chega aqui." maxLength={200} />
            {suggest && !errors.email && <button type="button" className="mt-1 text-[14px] font-semibold text-action underline" onClick={() => { setEmail(suggest); setSuggest(null); }}>Você quis dizer {suggest.split('@')[1]}?</button>}
          </div>
          <Field id="f-phone" label="Seu WhatsApp" type="tel" autoComplete="tel-national" inputMode="numeric" value={phone} onChange={e => setPhone(maskPhone(e.target.value))} error={errors.phone} big placeholder="(00) 00000-0000" />
          <Field id="f-doc" label="Seu CPF" inputMode="numeric" autoComplete="off" value={doc} onChange={e => setDoc(maskDoc(e.target.value))} error={errors.doc} big placeholder="000.000.000-00" />
        </div>}

        <fieldset className="mt-6">
          <legend className="mb-2 text-[14px] font-semibold">Como você quer pagar?</legend>
          <div role="radiogroup" className={cx('grid gap-2', offer.methods.length === 3 ? 'grid-cols-3' : offer.methods.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
            {ORDER.filter(m => offer.methods.includes(m)).map(m => (
              <label key={m} className={cx('flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-ctl border-2 px-2 text-[15px] font-bold transition-colors', method === m ? 'border-[var(--brand)] bg-action-soft/50 text-ink' : 'border-line text-ink-soft hover:border-action/40')}>
                <input type="radio" name="method" value={m} checked={method === m} onChange={() => { setMethod(m); setAlert(null); }} className="sr-only" />
                <MethodIcon m={m} />{m === 'pix' ? 'Pix' : m === 'card' ? 'Cartão' : 'Boleto'}
              </label>
            ))}
          </div>
          <div className="mt-3">
            {method === 'pix' && <p className="rounded-ctl bg-canvas px-4 py-3 text-[14.5px] text-ink-soft">Você paga pelo app do seu banco e o acesso é liberado na hora.</p>}
            {method === 'boleto' && <Banner tone="warn">O boleto leva até 3 dias úteis para compensar. Seu acesso é liberado depois disso.</Banner>}
 {method === 'card' && offer.one_click && oc.step !== 'ready' && (
              <div className="mb-3 rounded-ctl border border-line bg-white p-3 text-[14.5px]">
                {oc.step === 'off' ? <button type="button" className="min-h-[44px] text-left font-semibold text-action underline" onClick={ocStart}>Já comprou aqui com cartão? Pague com o cartão guardado</button>
                  : <div className="space-y-2">
                    <p>Enviamos um código de 6 números para <b>{email.trim().toLowerCase()}</b>.</p>
                    <div className="flex items-end gap-2">
                      <Field id="f-oc_code" label="Código do e-mail" inputMode="numeric" autoComplete="one-time-code" value={oc.code} onChange={e => setOc({ ...oc, code: digits(e.target.value).slice(0, 6) })} mono className="flex-1" />
                      <Button type="button" variant="secondary" loading={oc.busy} disabled={oc.code.length !== 6} onClick={ocVerify}>Confirmar</Button>
                    </div>
                    <button type="button" className="min-h-[36px] text-[13.5px] text-ink-mute underline" onClick={() => setOc({ step: 'off', code: '' })}>Digitar o cartão</button>
                  </div>}
                {oc.err && <p className="mt-1 text-[13.5px] text-bad">{oc.err}</p>}
              </div>
            )}
            {method === 'card' && ocReady && (
              <div className="space-y-2 rounded-ctl bg-canvas p-4">
                <p className="text-[14px] font-semibold">Seu cartão guardado</p>
                {oc.cards!.map(k => (
                  <label key={k.id} className={cx('flex min-h-[52px] cursor-pointer items-center gap-3 rounded-ctl border-2 bg-white px-3', oc.cardId === k.id ? 'border-[var(--brand)]' : 'border-line')}>
                    <input type="radio" name="saved_card" checked={oc.cardId === k.id} onChange={() => setOc({ ...oc, cardId: k.id })} />
                    <span className="capitalize">{k.brand}</span><span className="num">•••• {k.last4}</span>
                  </label>
                ))}
                {offer.billing_type !== 'subscription' && maxN > 1 && (
                  <select aria-label="Parcelas" value={installments} onChange={e => setInstallments(Number(e.target.value))} className="num min-h-[52px] w-full rounded-ctl border border-line bg-white px-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-action">
                    {Array.from({ length: maxN }, (_, k) => k + 1).map(n => { const x = plan(base, n, offer.installment_interest); return <option key={n} value={n}>{n}x de {brl(x.inst)}{x.free ? ' (sem juros)' : ''}</option>; })}
                  </select>
                )}
                <button type="button" className="min-h-[36px] text-[13.5px] text-ink-mute underline" onClick={() => setOc({ step: 'off', code: '' })}>Usar outro cartão</button>
              </div>
            )}
            {method === 'card' && !ocReady && (
              <div className="space-y-3 rounded-ctl bg-canvas p-4">
                <Field id="f-card_number" label="Número do cartão" inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={e => setCard({ ...card, number: digits(e.target.value).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ') })} error={errors.card_number} big mono right={brand ? <span className="text-[12px] font-bold uppercase text-ink-mute">{brand}</span> : null} />
                <div className="grid grid-cols-2 gap-3">
                  <Field id="f-card_exp" label="Validade" placeholder="MM/AA" inputMode="numeric" autoComplete="cc-exp" value={card.exp} onChange={e => { const d = digits(e.target.value).slice(0, 4); setCard({ ...card, exp: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d }); }} error={errors.card_exp} big mono />
                  <Field id="f-card_cvv" label="CVV" inputMode="numeric" autoComplete="cc-csc" value={card.cvv} onChange={e => setCard({ ...card, cvv: digits(e.target.value).slice(0, 4) })} error={errors.card_cvv} big mono />
                </div>
                {offer.billing_type !== 'subscription' && maxN > 1 && (
                  <div>
                    <label htmlFor="f-inst" className="mb-1.5 block text-[14px] font-semibold">Parcelas</label>
                    <select id="f-inst" value={installments} onChange={e => setInstallments(Number(e.target.value))} className="num min-h-[52px] w-full rounded-ctl border border-line bg-white px-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-action">
                      {Array.from({ length: maxN }, (_, k) => k + 1).map(n => { const x = plan(base, n, offer.installment_interest); return <option key={n} value={n}>{n}x de {brl(x.inst)}{x.free ? ' (sem juros)' : ''}</option>; })}
                    </select>
                  </div>
                )}
                {show3DSBill && <div className="space-y-3 border-t border-line pt-3">
                  <p className="text-[13.5px] text-ink-mute">Endereço da fatura do cartão — o banco usa para confirmar que é você.</p>
                  <div className="grid grid-cols-[1fr_96px] gap-3">
                    <Field id="f-bill_zip" label="CEP" inputMode="numeric" autoComplete="postal-code" value={bill.zip} onChange={e => { const v = digits(e.target.value).slice(0, 8); setBill({ ...bill, zip: v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v }); lookupZip(v); }} error={errors.bill_zip} />
                    <Field id="f-bill_number" label="Número" value={bill.number} onChange={e => setBill({ ...bill, number: e.target.value.slice(0, 10) })} error={errors.bill_number} />
                  </div>
                  <Field id="f-bill_street" label="Rua" autoComplete="address-line1" value={bill.street} onChange={e => setBill({ ...bill, street: e.target.value })} error={errors.bill_street} />
                  <div className="grid grid-cols-[1fr_1fr_72px] gap-3">
                    <Field id="f-bill_district" label="Bairro" value={bill.district} onChange={e => setBill({ ...bill, district: e.target.value })} error={errors.bill_district} />
                    <Field id="f-bill_city" label="Cidade" autoComplete="address-level2" value={bill.city} onChange={e => setBill({ ...bill, city: e.target.value })} error={errors.bill_city} />
                    <Field id="f-bill_state" label="UF" value={bill.state} onChange={e => setBill({ ...bill, state: e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() })} error={errors.bill_state} />
                  </div>
                </div>}
                {offer.one_click && <label className="flex min-h-[44px] cursor-pointer items-start gap-2 text-[14px] text-ink-soft"><input type="checkbox" className="mt-1" checked={saveCard} onChange={e => setSaveCard(e.target.checked)} /><span>Guardar este cartão para comprar com 1 clique. O número fica com o banco; você remove quando quiser em “Minhas compras”.</span></label>}
                {offer.gateway === 'sandbox' && <p className="text-[12.5px] text-ink-mute">Ambiente de teste: use 4111 1111 1111 1111, validade futura e qualquer CVV.</p>}
              </div>
            )}
            <div id="tdsMethodContainer" className="hidden" /><div id="challengeContainer" />
          </div>
        </fieldset>

        {offer.bumps.length > 0 && (
          <div className="mt-5 space-y-2">
            {offer.bumps.map(b => (
              <label key={b.offer_id} className={cx('flex cursor-pointer items-start gap-3 rounded-ctl border-2 border-dashed p-4 transition-colors', bumps.includes(b.offer_id) ? 'border-ok bg-ok-soft/60' : 'border-warn-line bg-warn-soft/50')}>
                <input type="checkbox" className="mt-1 h-5 w-5 flex-none accent-[#0F8A5F]" checked={bumps.includes(b.offer_id)} onChange={e => setBumps(e.target.checked ? [...bumps, b.offer_id] : bumps.filter(x => x !== b.offer_id))} />
                <span><span className="block text-[12px] font-extrabold uppercase tracking-wide text-[#7A4500]">Oferta especial</span><span className="block font-bold">Incluir {b.name} por mais <span className="num">{brl(b.price_cents)}</span></span>{b.headline && <span className="block text-[14px] text-ink-soft">{b.headline}</span>}</span>
              </label>
            ))}
          </div>
        )}

        {couponOpen && (
          <div className="mt-5 flex items-end gap-2">
            <Field label="Cupom" className="flex-1" value={couponInput} onChange={e => setCouponInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} error={couponErr} maxLength={20} mono />
            <Button type="button" variant="secondary" onClick={() => applyCoupon()} className={couponErr ? 'mb-[30px]' : ''}>Aplicar</Button>
          </div>
        )}

        <div className="mt-6 space-y-1 border-t border-line pt-4 text-[15px]">
          {(discount > 0 || bumpTotal > 0) && <Row label={offer.product.name} value={brl(offer.price_cents)} />}
          {offer.bumps.filter(b => bumps.includes(b.offer_id)).map(b => <Row key={b.offer_id} label={b.name} value={brl(b.price_cents)} />)}
          {discount > 0 && <Row label={`Cupom ${coupon!.code}`} value={`− ${brl(discount)}`} className="text-ok" />}
          {method === 'card' && !p.free && <Row label="Juros do parcelamento" value={brl(p.total - base)} className="text-ink-mute" />}
          <div className="flex items-baseline justify-between pt-1"><span className="font-bold">Total</span><span className="num text-[22px] font-bold">{brl(p.total)}</span></div>
          {method === 'card' && installments > 1 && <p className="text-right text-[14px] text-ink-mute">{installments}x de {brl(p.inst)}</p>}
        </div>

        {alert && (
          <div className="mt-4">
            <Banner tone="bad" action={alert.offerPix && method !== 'pix' ? <Button type="button" size="sm" variant="secondary" onClick={() => { setMethod('pix'); setAlert(null); }}>Pagar com Pix</Button> : undefined}>{alert.text}</Banner>
          </div>
        )}

        <Button type="submit" size="xl" full loading={busy} className="mt-5 h-[60px]" style={{ background: color }}>{btnLabel}</Button>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[13.5px] font-semibold text-ink-soft">
          <span className="inline-flex items-center gap-1.5"><LockIcon /> Compra segura</span>
          <span className="inline-flex items-center gap-1.5"><ShieldIcon /> {offer.guarantee_days} dias de garantia</span>
        </div>

        {offer.theme.testimonials?.length ? (
          <div className="mt-6 space-y-3 border-t border-line pt-5">
            {offer.theme.testimonials.map((t, i) => <blockquote key={i} className="rounded-ctl bg-canvas p-3 text-[14px]"><p>“{t.text}”</p><footer className="mt-1 font-bold">— {t.name}</footer></blockquote>)}
          </div>
        ) : null}

        <p className="mt-6 text-center text-[13.5px] text-ink-mute">
          Não precisa criar conta. · {!couponOpen && <><button type="button" className="font-semibold text-action underline" onClick={() => setCouponOpen(true)}>Tem um cupom?</button> · </>}
          <a href="/termos" className="underline">Termos</a> · <a href="/privacidade" className="underline">Privacidade</a>
        </p>
        <p className="mt-1 text-center text-[12.5px] text-ink-mute">Vendido por {offer.seller.name}. Processado por Domma Mart.</p>
      </form>
    </Shell>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return <div className={cx('flex justify-between gap-4', className)}><span className="truncate">{label}</span><span className="num">{value}</span></div>;
}

function Shell({ children, color, logo, countdown }: { children: React.ReactNode; color?: string; logo?: string; countdown?: number }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-[560px] px-4 pb-10 pt-5">
      {countdown ? <Countdown minutes={countdown} color={color} /> : null}
      <div className="mb-4 flex justify-center">{logo ? <img src={logo} alt="" className="h-9 object-contain" /> : <Logo className="text-[15px] text-ink-soft" />}</div>
      {children}
    </main>
  );
}

function Countdown({ minutes, color }: { minutes: number; color?: string }) {
  const [left, setLeft] = useState(minutes * 60);
  useEffect(() => {
    const key = `dm_cd_${location.pathname}`;
    let end = Number(sessionStorage.getItem(key));
    if (!end) { end = Date.now() + minutes * 60_000; sessionStorage.setItem(key, String(end)); }
    const t = setInterval(() => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [minutes]);
  if (!left) return null;
  return <div className="mb-4 rounded-ctl px-4 py-2.5 text-center text-[14.5px] font-bold text-white" style={{ background: color || '#5B3FE6' }}>Oferta especial termina em <span className="num">{String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</span></div>;
}

function MethodIcon({ m }: { m: string }) {
  if (m === 'pix') return <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path fill="#32BCAD" d="M17.6 16.9a2.9 2.9 0 0 1-2.1-.9l-3-3a.6.6 0 0 0-.8 0l-3 3a2.9 2.9 0 0 1-2.1.9H6l3.8 3.8a3 3 0 0 0 4.3 0l3.8-3.8h-.3zM6.6 7.1c.8 0 1.5.3 2.1.9l3 3a.6.6 0 0 0 .8 0l3-3c.6-.6 1.3-.9 2.1-.9h.3L14.1 3.3a3 3 0 0 0-4.3 0L6 7.1h.6zm14.1 2.8-2.3-2.3h-.8c-.5 0-1 .2-1.4.6l-3 3a1.6 1.6 0 0 1-2.3 0l-3-3c-.4-.4-.9-.6-1.4-.6h-1L3.3 9.9a3 3 0 0 0 0 4.3l2.2 2.2h1c.5 0 1-.2 1.4-.6l3-3a1.6 1.6 0 0 1 2.3 0l3 3c.4.4.9.6 1.4.6h.8l2.3-2.3a3 3 0 0 0 0-4.2z" /></svg>;
  if (m === 'card') return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>;
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14" /></svg>;
}
function LockIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-ok" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>; }
function ShieldIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-ok" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>; }
