'use client';
import { useState } from 'react';
import { post } from '@/lib/api';
import { Button, Card, Logo } from '@/components/ui';
export default function Descadastro() {
  const [done, setDone] = useState<null | boolean>(null);
  return (
    <main className="mx-auto max-w-[460px] px-4 py-10">
      <div className="mb-6 flex justify-center"><Logo /></div>
      <Card>
        {done ? <p className="font-bold">Pronto. Você não vai mais receber lembretes de compra.</p> : <>
          <h1 className="text-[20px] font-extrabold">Parar de receber lembretes?</h1>
          <p className="mt-1 text-ink-soft">Você continua recebendo os e-mails essenciais das suas compras, como o acesso e o recibo.</p>
          <Button full className="mt-5" onClick={async () => { try { await post('/v1/public/opt-out', { t: new URLSearchParams(location.search).get('t') }); setDone(true); } catch { setDone(false); } }}>Parar de receber</Button>
          {done === false && <p className="mt-3 text-bad">Este link expirou.</p>}
        </>}
      </Card>
    </main>
  );
}
