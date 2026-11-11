'use client';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui';

const ITEMS = [['/afiliado', 'Minhas afiliações'], ['/afiliado/marketplace', 'Marketplace'], ['/afiliado/ranking', 'Ranking'], ['/financeiro', 'Saques']] as const;

/** Menu do painel do afiliado (19.10). */
export function AffNav() {
  const path = usePathname();
  const on = (h: string) => (h === '/afiliado' ? path === h : path === h || path.startsWith(h + '/'));
  return <nav className="flex flex-wrap gap-1 text-[14px] font-semibold">{ITEMS.map(([h, l]) => <a key={h} href={h} className={cx('rounded-full px-3 py-1', on(h) ? 'bg-action text-white' : 'text-ink-soft hover:bg-canvas')}>{l}</a>)}</nav>;
}

/** Barrinha de temperatura (vendas recentes). */
export function Temp({ v }: { v: number }) {
  const tone = v >= 70 ? 'bg-bad' : v >= 40 ? 'bg-warn' : v > 0 ? 'bg-action' : 'bg-line';
  return <span className="inline-flex items-center gap-1.5" title={`Temperatura ${v}/100: vendas nos últimos 30 dias`}><span className="h-1.5 w-14 overflow-hidden rounded-full bg-line"><span className={cx('block h-full', tone)} style={{ width: `${Math.max(4, v)}%` }} /></span><span className="num text-[12.5px] text-ink-mute">{v}°</span></span>;
}
