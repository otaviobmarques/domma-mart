'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { Card, Skeleton } from '@/components/ui';
import { AffNav } from '@/components/aff-nav';
import { RankingList } from '@/components/aff-parts';

/** Ranking dos afiliados do mês, em toda a Domma Mart. */
export default function Ranking() {
  const [r, setR] = useState<any>(null);
  useEffect(() => { get('/v1/marketplace/ranking').then(setR); }, []);
  const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-extrabold">Ranking de afiliados</h1>
      <AffNav />
      <Card className="max-w-xl">
        <h2 className="font-extrabold">Quem mais vendeu em {month}</h2>
        <p className="mt-1 text-[14px] text-ink-mute">Conta as comissões de vendas pagas no mês (reembolsos e contestações saem). Mostramos só o primeiro nome e a inicial.</p>
        {!r ? <Skeleton className="mt-3 h-40" /> : <RankingList r={r} />}
      </Card>
    </div>
  );
}
