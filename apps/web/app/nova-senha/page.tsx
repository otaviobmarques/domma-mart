'use client';
import { useState } from 'react';
import { post, ApiError } from '@/lib/api';
import { Button, Field, Card, Banner, Logo } from '@/components/ui';
export default function NovaSenha() {
  const [p, setP] = useState(''); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false);
  return (
    <main className="mx-auto max-w-[420px] px-4 py-10"><div className="mb-6 flex justify-center"><Logo /></div>
      <Card>{ok ? <><p className="font-semibold">Senha alterada. Por segurança, encerramos as outras sessões.</p><a href="/entrar" className="mt-3 inline-block font-bold text-action">Entrar</a></> : <>
        <h1 className="text-[22px] font-extrabold">Nova senha</h1>
        <form className="mt-4 space-y-4" onSubmit={async e => { e.preventDefault(); setErr(null); try { await post('/v1/auth/reset', { token: new URLSearchParams(location.search).get('token'), password: p }); setOk(true); } catch (x) { setErr((x as ApiError).title); } }}>
          <Field label="Nova senha" type="password" autoComplete="new-password" value={p} onChange={e => setP(e.target.value)} hint="Mínimo de 9 caracteres." />
          {err && <Banner tone="bad">{err}</Banner>}
          <Button type="submit" full>Salvar nova senha</Button>
        </form></>}</Card></main>
  );
}
