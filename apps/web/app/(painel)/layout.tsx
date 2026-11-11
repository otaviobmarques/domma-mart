'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { get, post } from '@/lib/api';
import { MeCtx, Me } from '@/components/session';
import { Banner, Button, Logo, Skeleton, cx } from '@/components/ui';

const NAV = [
  { href: '/inicio', label: 'Início', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { href: '/produtos', label: 'Produtos', icon: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10' },
  { href: '/vendas', label: 'Vendas', icon: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6' },
  { href: '/financeiro', label: 'Financeiro', icon: 'M3 7h18v12H3zM3 11h18M7 15h3' },
  { href: '/afiliados', label: 'Afiliados', icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5' },
  { href: '/configuracoes', label: 'Configurações', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
];
const HELP = 'https://wa.me/5531999990000?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20com%20a%20Domma%20Mart';

function Icon({ d, className }: { d: string; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={cx('h-5 w-5 flex-none', className)} aria-hidden="true"><path d={d} /></svg>;
}

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [more, setMore] = useState(false);
  const path = usePathname();
  const load = () => get<Me>('/v1/auth/me').then(m => { setMe(m); if (m.workspace) localStorage.setItem('dm_ws', m.workspace.id); }).catch(() => {});
  useEffect(() => { load(); if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []);
  useEffect(() => setMore(false), [path]);

  if (!me) return <div className="flex min-h-screen"><aside className="hidden w-60 border-r border-line bg-white p-4 md:block"><Skeleton className="h-8 w-32" /></aside><main className="flex-1 p-6"><Skeleton className="h-10 w-64" /><Skeleton className="mt-6 h-40 w-full" /></main></div>;
  const active = (h: string) => path === h || path.startsWith(h + '/') || (h === '/afiliados' && path.startsWith('/afiliado'));
  return (
    <MeCtx.Provider value={{ me, reload: load }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 flex-none flex-col border-r border-line bg-white md:flex">
          <div className="px-5 py-5"><Logo /></div>
          <nav className="flex-1 space-y-0.5 px-3" aria-label="Menu principal">
            {NAV.map(n => <a key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={cx('flex min-h-[44px] items-center gap-3 rounded-ctl px-3 font-semibold', active(n.href) ? 'bg-action-soft text-action-ink' : 'text-ink-soft hover:bg-canvas')}><Icon d={n.icon} />{n.label}</a>)}
            {me.user.platform_role !== 'none' && <a href="/admin" className="mt-4 flex min-h-[44px] items-center gap-3 rounded-ctl px-3 text-[14px] font-semibold text-ink-mute hover:bg-canvas">Back-office Domma</a>}
          </nav>
          <div className="border-t border-line p-3">
            <a href={HELP} target="_blank" className="flex min-h-[44px] items-center gap-3 rounded-ctl px-3 font-semibold text-ok hover:bg-ok-soft"><Icon d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z" />Ajuda no WhatsApp</a>
            <div className="mt-2 flex items-center justify-between px-3 text-[13px] text-ink-mute"><span className="truncate">{me.user.name}</span><button className="font-semibold hover:text-ink" onClick={async () => { await post('/v1/auth/logout'); localStorage.removeItem('dm_ws'); location.href = '/entrar'; }}>Sair</button></div>
          </div>
        </aside>
        <div className="min-w-0 flex-1 pb-24 md:pb-10">
          <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden"><Logo className="text-[15px]" /><a href={HELP} target="_blank" className="text-[14px] font-semibold text-ok">Ajuda</a></header>
          <div className="mx-auto max-w-6xl space-y-2 px-4 pt-4 md:px-8">
            {me.workspace?.blocked && <Banner tone="bad" action={<a href={HELP} className="font-bold underline">Falar com o suporte</a>}>Sua conta está temporariamente bloqueada{me.workspace.blocked_reason ? `: ${me.workspace.blocked_reason}` : '.'}</Banner>}
            {me.workspace && !me.workspace.blocked && me.receiving_ready === false && me.workspace.kyc_status === 'in_review' && !path.startsWith('/financeiro') && (
              <Banner tone="warn" action={<a href="/financeiro"><Button size="sm" variant="secondary">Cadastrar conta</Button></a>}>Para começar a vender, cadastre a conta bancária que vai receber seu dinheiro.</Banner>
            )}
            {me.workspace && !me.workspace.blocked && me.workspace.kyc_status !== 'approved' && !path.startsWith('/identidade') && (
              me.workspace.kyc_status === 'in_review'
                ? <Banner tone="info">Recebemos seus documentos. Avisamos em até 1 dia útil.</Banner>
                : <Banner tone="warn" action={<a href="/identidade"><Button size="sm" variant="secondary">Confirmar identidade</Button></a>}>{me.receiving_ready === false ? 'Confirme sua identidade para poder vender e sacar.' : 'Confirme sua identidade para poder sacar.'}</Banner>
            )}
            {!me.user.email_verified && <Banner tone="info" action={<button className="font-bold underline" onClick={() => post('/v1/auth/resend-verification').then(() => alert('Enviamos um novo link para o seu e-mail.'))}>Reenviar</button>}>Confirme seu e-mail pelo link que enviamos para {me.user.email}.</Banner>}
          </div>
          <main className="mx-auto max-w-6xl px-4 py-5 md:px-8">{children}</main>
        </div>
        {/* Celular: barra inferior com 5 ícones + Mais */}
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Menu">
          {NAV.slice(0, 5).map(n => <a key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={cx('flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold', active(n.href) ? 'text-action' : 'text-ink-mute')}><Icon d={n.icon} />{n.label}</a>)}
          <button onClick={() => setMore(!more)} className={cx('flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold', more ? 'text-action' : 'text-ink-mute')}><Icon d="M5 12h.01M12 12h.01M19 12h.01" />Mais</button>
        </nav>
        {more && <div className="fixed inset-x-0 bottom-[60px] z-40 space-y-1 border-t border-line bg-white p-3 shadow-xl md:hidden">
          <a href="/configuracoes" className="flex min-h-[48px] items-center rounded-ctl px-3 font-semibold">Configurações</a>
          <a href="/afiliado" className="flex min-h-[48px] items-center rounded-ctl px-3 font-semibold">Painel do afiliado</a>
          <a href="/identidade" className="flex min-h-[48px] items-center rounded-ctl px-3 font-semibold">Confirmar identidade</a>
          {me.user.platform_role !== 'none' && <a href="/admin" className="flex min-h-[48px] items-center rounded-ctl px-3 font-semibold">Back-office Domma</a>}
          <button className="flex min-h-[48px] w-full items-center rounded-ctl px-3 font-semibold text-ink-mute" onClick={async () => { await post('/v1/auth/logout'); location.href = '/entrar'; }}>Sair</button>
        </div>}
      </div>
    </MeCtx.Provider>
  );
}
