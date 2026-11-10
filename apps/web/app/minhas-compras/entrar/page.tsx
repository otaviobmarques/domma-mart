'use client';
import { useEffect, useState } from 'react';
import { post, ApiError } from '@/lib/api';
import { maskPhone, digits } from '@/lib/format';
import { Button, Field, Card, Banner, Logo } from '@/components/ui';

export default function Entrar() {
  const [mode, setMode] = useState<'email' | 'sent' | 'phone' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  // abrir o link mágico
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('token');
    if (!token) return;
    setBusy(true);
    post('/v1/customer/auth/verify', { token }).then(() => location.replace('/minhas-compras')).catch((e: ApiError) => { setBusy(false); setErr(e.code === 'AUTH_LINK_EXPIRED' ? 'Este link expirou. Peça um novo.' : e.title); history.replaceState(null, '', '/minhas-compras/entrar'); });
  }, []);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  async function sendLink(e?: React.FormEvent) {
    e?.preventDefault(); setErr(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErr('Confira seu e-mail. Ele parece estar incompleto.'); return; }
    setBusy(true);
    try { await post('/v1/customer/auth/magic-link', { email: email.trim() }); setMode('sent'); setWait(60); }
    catch (x) { setErr((x as ApiError).code === 'RATE_LIMITED' ? 'Aguarde alguns minutos para pedir outro link.' : (x as ApiError).title); }
    setBusy(false);
  }
  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault(); setErr(null);
    if (digits(phone).length !== 11) { setErr('Confira o número com DDD.'); return; }
    setBusy(true);
    try { await post('/v1/customer/auth/otp', { phone }); setMode('code'); setWait(60); }
    catch (x) { setErr((x as ApiError).code === 'RATE_LIMITED' ? 'Aguarde alguns minutos para pedir outro código.' : (x as ApiError).title); }
    setBusy(false);
  }
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await post('/v1/customer/auth/verify', { phone, code }); location.href = '/minhas-compras'; }
    catch (x) { setErr((x as ApiError).title); setBusy(false); }
  }

  return (
    <main className="mx-auto w-full max-w-[460px] px-4 py-8">
      <div className="mb-6 flex justify-center"><Logo /></div>
      <Card>
        {mode === 'sent' ? (
          <div role="status">
            <h1 className="text-[22px] font-extrabold">Confira seu e-mail</h1>
            <p className="mt-2 text-ink-soft">Se houver compras em <b>{email}</b>, enviamos um link para entrar. Ele vale por <b>15 minutos</b> e só pode ser usado uma vez.</p>
            <div className="mt-6 space-y-2">
              <Button variant="secondary" full disabled={wait > 0} onClick={() => sendLink()}>{wait > 0 ? `Reenviar em ${wait}s` : 'Reenviar link'}</Button>
              <Button variant="ghost" full onClick={() => { setMode('email'); setEmail(''); }}>Usar outro e-mail</Button>
            </div>
          </div>
        ) : mode === 'phone' || mode === 'code' ? (
          <form onSubmit={mode === 'phone' ? sendCode : verifyCode} noValidate>
            <h1 className="text-[22px] font-extrabold">Entrar pelo WhatsApp</h1>
            <p className="mt-1 text-ink-soft">Use o número que você informou na compra.</p>
            <div className="mt-5 space-y-4">
              <Field label="Seu WhatsApp" type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={e => setPhone(maskPhone(e.target.value))} disabled={mode === 'code'} big />
              {mode === 'code' && <Field label="Código de 6 dígitos" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(digits(e.target.value).slice(0, 6))} big mono autoFocus hint="Enviamos o código para o seu WhatsApp. Ele vale por 10 minutos." />}
            </div>
            {err && <Banner tone="bad" className="mt-4">{err}</Banner>}
            <Button type="submit" size="lg" full className="mt-5" loading={busy}>{mode === 'phone' ? 'Receber código no WhatsApp' : 'Entrar'}</Button>
            {mode === 'code' && <Button type="button" variant="ghost" full className="mt-2" disabled={wait > 0} onClick={() => sendCode()}>{wait > 0 ? `Reenviar em ${wait}s` : 'Reenviar código'}</Button>}
            <Button type="button" variant="ghost" full className="mt-2" onClick={() => { setMode('email'); setErr(null); }}>Entrar com e-mail</Button>
          </form>
        ) : (
          <form onSubmit={sendLink} noValidate>
            <h1 className="text-[22px] font-extrabold">Suas compras</h1>
            <p className="mt-1 text-ink-soft">Entre sem senha. Digite o e-mail que você usou na compra e enviamos um link de acesso.</p>
            <Field label="Seu e-mail" type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} big className="mt-5" />
            {err && <Banner tone="bad" className="mt-4">{err}</Banner>}
            <Button type="submit" size="lg" full className="mt-5" loading={busy}>Receber link de acesso</Button>
            <Button type="button" variant="secondary" full className="mt-2" onClick={() => { setMode('phone'); setErr(null); }}>Receber código no WhatsApp</Button>
          </form>
        )}
      </Card>
      <p className="mt-5 text-center text-[14px]"><a className="font-semibold text-action" href="https://wa.me/5531999990000">Fale com o suporte no WhatsApp</a></p>
    </main>
  );
}
