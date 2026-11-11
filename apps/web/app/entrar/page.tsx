'use client';
import { useEffect, useState } from 'react';
import { GoogleButton, GOOGLE_ERRORS } from '@/components/google-button';
import { post, ApiError } from '@/lib/api';
import { Button, Field, Card, Banner, Logo } from '@/components/ui';

const safeBack = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/inicio');

export default function Entrar() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  // segunda etapa: código do aplicativo (login por senha) ou bilhete do login com Google
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [ticket, setTicket] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [back, setBack] = useState('/inicio');
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const e = q.get('erro'); if (e) setErr(GOOGLE_ERRORS[e] ?? 'Não foi possível entrar.');
    setBack(safeBack(q.get('volta')));
    const m = q.get('mfa'); if (m) { setTicket(m); setStep('otp'); history.replaceState(null, '', location.pathname + (q.get('volta') ? `?volta=${encodeURIComponent(q.get('volta')!)}` : '')); }
  }, []);

  const fail = (x: unknown) => {
    const a = x as ApiError;
    setErr(a.code === 'RATE_LIMITED' ? 'Muitas tentativas. Aguarde alguns minutos.' : a.code === 'OTP_INVALID' ? 'Código incorreto. Confira o aplicativo e tente de novo.' : a.code === 'OTP_LOCKED' ? 'Muitos códigos errados. Aguarde 30 minutos.' : a.title);
    setBusy(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      if (ticket) await post('/v1/auth/login/2fa', { ticket, otp });
      else {
        const r = await post<{ ok: boolean; needs_otp?: boolean }>('/v1/auth/login', { email, password, otp: step === 'otp' ? otp : undefined });
        if (r.needs_otp) { setStep('otp'); setBusy(false); return; }
      }
      location.href = back;
    } catch (x) {
      if ((x as ApiError).code === 'AUTH_LINK_EXPIRED' && ticket) { setTicket(null); setStep('password'); }
      fail(x);
    }
  }
  return (
    <main className="mx-auto w-full max-w-[420px] px-4 py-10">
      <div className="mb-6 flex justify-center"><Logo /></div>
      <Card>
        <h1 className="text-[22px] font-extrabold">{step === 'otp' ? 'Código de verificação' : 'Entrar'}</h1>
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          {step === 'password' ? <>
            <Field label="E-mail ou usuário" type="text" autoComplete="username" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)} />
            <Field label="Senha" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </> : <>
            <p className="text-[14.5px] text-ink-soft">Sua conta usa verificação em duas etapas. Digite o código de 6 números que aparece no seu aplicativo autenticador.</p>
            <Field label="Código do aplicativo" inputMode="numeric" autoComplete="one-time-code" autoFocus value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} mono big />
          </>}
          {err && <Banner tone="bad">{err}</Banner>}
          <Button type="submit" size="lg" full loading={busy} disabled={step === 'otp' && otp.length !== 6}>{step === 'otp' ? 'Confirmar' : 'Entrar'}</Button>
          {step === 'otp' && <button type="button" className="w-full text-[14px] font-semibold text-ink-mute underline" onClick={() => { setStep('password'); setTicket(null); setOtp(''); setErr(null); }}>Voltar</button>}
        </form>
        {step === 'password' && <>
          <GoogleButton href={`/v1/auth/google/start?volta=${encodeURIComponent(back)}`} />
          <div className="mt-4 flex justify-between text-[14px]"><a href="/esqueci-senha" className="font-semibold text-action">Esqueci a senha</a><a href="/criar-conta" className="font-semibold text-action">Criar conta</a></div>
        </>}
      </Card>
      <p className="mt-5 text-center text-[14px] text-ink-mute">Comprou um curso? <a href="/minhas-compras/entrar" className="font-semibold text-action">Acesse suas compras</a></p>
    </main>
  );
}
