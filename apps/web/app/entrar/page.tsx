'use client';
import { useEffect, useState } from 'react';
import { GoogleButton, GOOGLE_ERRORS } from '@/components/google-button';
import { post, ApiError } from '@/lib/api';
import { Button, Field, Card, Banner, Logo } from '@/components/ui';

export default function Entrar() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [back, setBack] = useState('/inicio');
  useEffect(() => { const q = new URLSearchParams(location.search); const e = q.get('erro'); if (e) setErr(GOOGLE_ERRORS[e] ?? 'Não foi possível entrar.'); const v = q.get('volta'); if (v && v.startsWith('/') && !v.startsWith('//')) setBack(v); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await post('/v1/auth/login', { email, password });
      const back = new URLSearchParams(location.search).get('volta');
      location.href = back && back.startsWith('/') && !back.startsWith('//') ? back : '/inicio';
    } catch (x) { setErr((x as ApiError).code === 'RATE_LIMITED' ? 'Muitas tentativas. Aguarde alguns minutos.' : (x as ApiError).title); setBusy(false); }
  }
  return (
    <main className="mx-auto w-full max-w-[420px] px-4 py-10">
      <div className="mb-6 flex justify-center"><Logo /></div>
      <Card>
        <h1 className="text-[22px] font-extrabold">Entrar</h1>
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <Field label="E-mail" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
          <Field label="Senha" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          {err && <Banner tone="bad">{err}</Banner>}
          <Button type="submit" size="lg" full loading={busy}>Entrar</Button>
        </form>
        <GoogleButton href={`/v1/auth/google/start?volta=${encodeURIComponent(back)}`} />
        <div className="mt-4 flex justify-between text-[14px]"><a href="/esqueci-senha" className="font-semibold text-action">Esqueci a senha</a><a href="/criar-conta" className="font-semibold text-action">Criar conta</a></div>
      </Card>
      <p className="mt-5 text-center text-[14px] text-ink-mute">Comprou um curso? <a href="/minhas-compras/entrar" className="font-semibold text-action">Acesse suas compras</a></p>
    </main>
  );
}
