'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { brl } from '@/lib/format';
import { Button, Card, Skeleton, Empty, Pill, Initials, CopyButton } from '@/components/ui';

const TYPE: Record<string, string> = { course: 'Curso online', file: 'E-book ou arquivo', service: 'Mentoria ou serviço', subscription: 'Assinatura' };
export default function Produtos() {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { get('/v1/products').then(setList); }, []);
  return (
    <div>
      <div className="flex items-center justify-between gap-3"><h1 className="text-[26px] font-extrabold">Produtos</h1><a href="/produtos/novo"><Button>+ Criar produto</Button></a></div>
      <div className="mt-5 space-y-3">
        {!list ? [0, 1].map(i => <Skeleton key={i} className="h-24 w-full" />) : list.length === 0 ? <Empty title="Você ainda não tem produtos" action={<a href="/produtos/novo"><Button>Criar meu primeiro produto</Button></a>}>Leva menos de 10 minutos.</Empty> :
          list.map(p => (
            <Card key={p.id} className="flex flex-wrap items-center gap-4">
              <Initials name={p.name} src={p.cover_url} size={56} />
              <div className="min-w-0 flex-1">
                <a href={`/produtos/${p.id}`} className="font-bold hover:text-action">{p.name}</a>
                <p className="text-[14px] text-ink-mute">{TYPE[p.type]} · <span className="num">{brl(p.offers[0]?.price_cents)}</span> · {Number(p.sales.n)} vendas</p>
                <div className="mt-1">{p.moderation_status === 'draft' ? <Pill>Rascunho</Pill> : p.moderation_status === 'in_review' ? <Pill tone="warn">Em análise</Pill> : p.moderation_status === 'rejected' ? <Pill tone="bad">Não aprovado</Pill> : <Pill tone="ok">À venda</Pill>}</div>
              </div>
              <div className="flex gap-2">{p.moderation_status === 'approved' && p.checkout_url && <CopyButton text={p.checkout_url} label="Copiar link" size="sm" />}<a href={`/produtos/${p.id}`}><Button size="sm" variant="secondary">Editar</Button></a></div>
            </Card>
          ))}
      </div>
    </div>
  );
}
