'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { Card, Logo } from '@/components/ui';
export default function Confirmar() {
  const [s, setS] = useState<'wait' | 'ok' | 'bad'>('wait');
  useEffect(() => { post('/v1/auth/verify-email', { token: new URLSearchParams(location.search).get('token') }).then(() => setS('ok')).catch(() => setS('bad')); }, []);
  return <main className="mx-auto max-w-[420px] px-4 py-10"><div className="mb-6 flex justify-center"><Logo /></div><Card>{s === 'wait' ? 'Confirmando…' : s === 'ok' ? <><p className="font-bold">E-mail confirmado!</p><a href="/inicio" className="mt-3 inline-block font-bold text-action">Ir para o painel</a></> : <p className="font-bold">Este link expirou. Peça um novo no painel.</p>}</Card></main>;
}
