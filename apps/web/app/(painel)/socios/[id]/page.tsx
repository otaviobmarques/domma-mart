'use client';
import { use, useState } from 'react';
import { post, ApiError } from '@/lib/api';
import { Button, Card, Banner } from '@/components/ui';
export default function Socio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [m, setM] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  return (
    <Card className="mx-auto max-w-lg">
      <h1 className="text-[22px] font-extrabold">Convite de sociedade</h1>
      <p className="mt-1 text-ink-soft">Ao aceitar, você passa a receber a sua parte de cada venda deste produto direto no seu saldo.</p>
      {m && <Banner tone={m.tone} className="mt-4">{m.text}</Banner>}
      <Button className="mt-5" full onClick={async () => { try { await post(`/v1/auth/coproductions/${id}/accept`); setM({ tone: 'ok', text: 'Sociedade aceita!' }); } catch (e) { const x = e as ApiError; setM({ tone: 'bad', text: x.title }); } }}>Aceitar sociedade</Button>
    </Card>
  );
}
