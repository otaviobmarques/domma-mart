'use client';
import { brl } from '@/lib/format';
import { CopyButton, Pill, cx } from '@/components/ui';

export type Material = { id: string; kind: 'link' | 'text'; title: string; url: string | null; body: string | null };

/** Materiais de divulgação (links para pastas/vídeos e textos prontos para copiar). */
export function Materials({ items }: { items: Material[] }) {
  if (!items.length) return <p className="mt-2 text-[14px] text-ink-mute">O produtor ainda não deixou materiais.</p>;
  return <ul className="mt-2 divide-y divide-line">{items.map(m => (
    <li key={m.id} className="py-3">
      <div className="flex items-center justify-between gap-2"><p className="font-semibold">{m.title}</p>
        {m.kind === 'link' ? <a href={m.url!} target="_blank" rel="noopener noreferrer nofollow" className="text-[14px] font-semibold text-action">Abrir ↗</a> : <CopyButton text={m.body ?? ''} size="sm" label="Copiar texto" />}</div>
      {m.kind === 'text' && <p className="mt-1 line-clamp-4 whitespace-pre-line text-[14px] text-ink-soft">{m.body}</p>}
    </li>))}</ul>;
}

type Rank = { top: { position: number; name: string; sales: number; me: boolean; commissions_cents?: number }[]; me: { position: number; sales: number; commissions_cents: number } | null };

export function RankingList({ r }: { r: Rank }) {
  if (!r.top.length) return <p className="mt-2 text-[14px] text-ink-mute">Ninguém vendeu este mês ainda. Seja o primeiro!</p>;
  return (<>
    <ol className="mt-2 divide-y divide-line">{r.top.map(x => (
      <li key={x.position} className={cx('flex items-center justify-between gap-2 py-2', x.me && 'font-bold text-action')}>
        <span className="flex items-center gap-2"><span className={cx('num flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold', x.position <= 3 ? 'bg-warn-soft text-[#7A4500]' : 'bg-canvas text-ink-mute')}>{x.position}</span>{x.name}{x.me && <Pill tone="action">você</Pill>}</span>
        <span className="num text-[14px] text-ink-mute">{x.sales} {x.sales === 1 ? 'venda' : 'vendas'}</span>
      </li>))}</ol>
    {r.me && <p className="mt-3 rounded-ctl bg-action-soft px-3 py-2 text-[14px]">Sua posição: <b className="num">{r.me.position}º</b> · {r.me.sales} vendas · <span className="num">{brl(r.me.commissions_cents)}</span> em comissões</p>}
  </>);
}
