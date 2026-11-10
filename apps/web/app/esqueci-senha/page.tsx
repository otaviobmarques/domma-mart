'use client';
import { useState } from 'react';
import { post } from '@/lib/api';
import { Button, Field, Card, Logo } from '@/components/ui';
export default function Esqueci() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto max-w-[420px] px-4 py-10"><div className="mb-6 flex justify-center"><Logo /></div>
      <Card>{sent ? <p className="font-semibold">Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha. Ele vale por 30 minutos.</p> : <>
        <h1 className="text-[22px] font-extrabold">Esqueci a senha</h1>
        <form className="mt-4 space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); await post('/v1/auth/forgot', { email }).catch(() => {}); setSent(true); }}>
          <Field label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <Button type="submit" full loading={busy}>Enviar link</Button>
        </form></>}</Card></main>
  );
}
