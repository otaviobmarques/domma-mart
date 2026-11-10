'use client';
import { use, useEffect, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { brl, pct } from '@/lib/format';
import { Button, Card, Banner, Logo, Initials, Skeleton } from '@/components/ui';
export default function Afiliar({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const [p, setP] = useState<any>(null); const [m, setM] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  useEffect(() => { get(`/v1/public/affiliate-program/${productId}`).then(setP).catch(() => setM({ tone: 'bad', text: 'Este programa de afiliados não está disponível.' })); }, [productId]);
  return (
    <main className="mx-auto max-w-lg px-4 py-10"><div className="mb-6 flex justify-center"><Logo /></div>
      {m && <Banner tone={m.tone} className="mb-4">{m.text}</Banner>}
      {!p ? !m && <Skeleton className="h-48" /> : <Card>
        <div className="flex gap-4"><Initials name={p.name} src={p.cover_url} size={64} /><div><p className="text-[19px] font-extrabold leading-tight">{p.name}</p><p className="text-ink-mute">por {p.producer} · {brl(p.price_cents)}</p></div></div>
        <ul className="mt-5 space-y-1 text-[15px]"><li>Comissão: <b>{pct(p.commission_bps)}</b> por venda</li><li>Cookie: <b>{p.cookie_days} dias</b> ({p.attribution === 'last_click' ? 'último clique' : 'primeiro clique'})</li><li>{p.auto_approve ? 'Aprovação automática' : 'O produtor aprova cada afiliado'}</li></ul>
        <Button full size="lg" className="mt-6" onClick={async () => { try { const r = await post('/v1/affiliate/request', { product_id: productId }); setM({ tone: 'ok', text: r.status === 'active' ? 'Pronto! Seu link está no Painel do afiliado.' : 'Pedido enviado. Avisamos quando o produtor aprovar.' }); setTimeout(() => (location.href = '/afiliado'), 1500); } catch (e) { const x = e as ApiError; if (x.status === 401) location.href = `/entrar?volta=/afiliar/${productId}`; else setM({ tone: 'bad', text: x.title }); } }}>Quero me afiliar</Button>
        <p className="mt-3 text-center text-[13.5px] text-ink-mute">Precisa de uma conta Domma Mart (grátis). <a href="/criar-conta" className="font-semibold text-action">Criar conta</a></p>
      </Card>}
    </main>
  );
}
