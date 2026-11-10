'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { brl, pct } from '@/lib/format';
import { Button, Card, Skeleton, Empty, Pill } from '@/components/ui';

/** Afiliados do lado do produtor (19.12 e): programas por produto. */
export default function Afiliados() {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { get('/v1/products').then(setList); }, []);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-[26px] font-extrabold">Afiliados</h1><a href="/afiliado"><Button variant="secondary">Meu painel de afiliado →</Button></a></div>
      <p className="text-ink-soft">Deixe outras pessoas venderem seus produtos em troca de comissão. Você define a % e o prazo do cookie; o sistema divide cada venda automaticamente.</p>
      {!list ? <Skeleton className="h-40 w-full" /> : list.length === 0 ? <Empty title="Crie um produto para ativar afiliados" /> :
        <div className="grid gap-3 md:grid-cols-2">{list.map(p => (
          <Card key={p.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="truncate font-bold">{p.name}</p><p className="text-[14px] text-ink-mute">{p.affiliation_enabled ? <>Comissão {pct(p.affiliate_commission_bps)} · cookie {p.affiliate_cookie_days} dias</> : 'Afiliação desligada'}</p></div>
            <div className="flex flex-none items-center gap-2">{p.affiliation_enabled ? <Pill tone="ok">Ativo</Pill> : <Pill>Desligado</Pill>}<a href={`/produtos/${p.id}?aba=afiliados`}><Button size="sm" variant="secondary">Configurar</Button></a></div>
          </Card>))}</div>}
    </div>
  );
}
