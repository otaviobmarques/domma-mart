'use client';
import { useEffect, useState } from 'react';
import { GoogleButton } from '@/components/google-button';
import { post, ApiError } from '@/lib/api';
import { maskPhone } from '@/lib/format';
import { Button, Field, Card, Banner, Logo } from '@/components/ui';

function strength(p: string) {
  let s = 0; if (p.length >= 10) s++; if (p.length >= 14) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}
export default function CriarConta() {
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = strength(f.password);
  const [fromGoogle, setFromGoogle] = useState(false);
  useEffect(() => { const q = new URLSearchParams(location.search); if (q.get('google') === '1') { setFromGoogle(true); setF(x => ({ ...x, email: q.get('email') ?? x.email })); } }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const ee: Record<string, string> = {};
    if (f.name.trim().split(/\s+/).length < 2) ee.name = 'Digite seu nome completo.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) ee.email = 'Confira seu e-mail.';
    if (f.password.length < 10) ee.password = 'Use uma senha com pelo menos 10 caracteres.';
    if (!accept) ee.accept = 'Para continuar, aceite os termos.';
    setErrors(ee); if (Object.keys(ee).length) return;
    setBusy(true);
    try { await post('/v1/auth/signup', { ...f, accept_terms: true }); location.href = '/inicio'; }
    catch (x) { const a = x as ApiError; setErrors(a.fields ?? {}); if (!Object.keys(a.fields ?? {}).length) setErr(a.title); setBusy(false); }
  }
  return (
    <main className="mx-auto w-full max-w-[440px] px-4 py-10">
      <div className="mb-6 flex justify-center"><Logo /></div>
      <Card>
        <h1 className="text-[22px] font-extrabold">Comece a vender hoje</h1>
        <p className="mt-1 text-ink-soft">Sem mensalidade. Você só paga 4,49% + R$ 1,49 quando vender.</p>
        {fromGoogle && <Banner tone="info" className="mt-4">Para criar sua conta com Google, aceite os termos abaixo e clique em “Continuar com Google” de novo.</Banner>}
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <Field label="Seu nome" autoComplete="name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} error={errors.name} />
          <Field label="E-mail" type="email" autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} error={errors.email} />
          <Field label="Celular" type="tel" inputMode="numeric" autoComplete="tel-national" value={f.phone} onChange={e => setF({ ...f, phone: maskPhone(e.target.value) })} error={errors.phone} />
          <div>
            <Field label="Senha" type="password" autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} error={errors.password} hint="Mínimo de 10 caracteres." />
            {f.password && <div className="mt-2 flex gap-1" aria-label={`Força da senha: ${['fraca', 'fraca', 'média', 'boa', 'forte'][s]}`}>{[0, 1, 2, 3].map(i => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < s ? (s >= 3 ? 'bg-ok' : 'bg-warn-line') : 'bg-line'}`} />)}</div>}
          </div>
          <label className="flex items-start gap-3 text-[14px]"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#5B3FE6]" checked={accept} onChange={e => setAccept(e.target.checked)} /><span>Li e aceito os <a href="/termos" className="font-semibold text-action underline">Termos de Uso</a>, a <a href="/privacidade" className="font-semibold text-action underline">Política de Privacidade</a> e a <a href="/produtos-proibidos" className="font-semibold text-action underline">Política de Produtos Proibidos</a>.</span></label>
          {errors.accept && <p className="text-[13.5px] font-medium text-bad">{errors.accept}</p>}
          {err && <Banner tone="bad">{err}</Banner>}
          <Button type="submit" size="lg" full loading={busy}>Criar conta</Button>
        </form>
        <GoogleButton href="/v1/auth/google/start?aceite=1&volta=/inicio" disabled={!accept} onBlocked={() => setErrors(x => ({ ...x, accept: 'Para continuar, aceite os termos.' }))} />
        <p className="mt-4 text-center text-[14px]">Já tem conta? <a href="/entrar" className="font-semibold text-action">Entrar</a></p>
      </Card>
    </main>
  );
}
