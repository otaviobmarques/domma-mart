'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { get, ApiError } from '@/lib/api';
import { Logo, Banner, cx } from '@/components/ui';

const NAV = [['/admin', 'Visão geral', null], ['/admin?v=kyc', 'Fila de KYC', 'kyc'], ['/admin?v=moderacao', 'Moderação de produtos', 'moderation'], ['/admin?v=disputas', 'Disputas e chargebacks', 'disputes'], ['/admin?v=risco', 'Alertas de risco', null], ['/admin?v=contas', 'Contas', null], ['/admin?v=pedidos', 'Pedidos', null], ['/admin?v=ajustes', 'Ajustes de saldo', 'adjustments'], ['/admin?v=conciliacao', 'Conciliação', null], ['/admin?v=auditoria', 'Auditoria', null]] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [ov, setOv] = useState<any>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [v, setV] = useState('');
  usePathname();
  useEffect(() => { setV(new URLSearchParams(location.search).get('v') ?? ''); get('/v1/admin/overview').then(setOv).catch(setErr); }, []);
  if (err) return <main className="mx-auto max-w-lg p-8"><Banner tone="bad">{err.code === 'TWO_FACTOR_REQUIRED' ? 'Ative a verificação em duas etapas (Configurações) para acessar o back-office.' : err.code === 'UNAUTHENTICATED' ? 'Entre com sua conta Domma.' : 'Você não tem acesso ao back-office.'}</Banner></main>;
  const counts: Record<string, number> = ov ? { kyc: ov.pending.kyc, moderation: ov.pending.moderation, disputes: ov.pending.disputes, adjustments: ov.pending.adjustments } : {};
  return (
    <div className="flex min-h-screen bg-[#F3F2F8]">
      <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col bg-ink text-white md:flex">
        <div className="px-5 py-5 [&_*]:text-white"><Logo /><p className="mt-1 text-[12px] font-bold uppercase tracking-widest text-white/50">Back-office</p></div>
        <nav className="flex-1 space-y-0.5 px-3">{NAV.map(([h, l, k]) => { const key = h.split('v=')[1] ?? ''; return <a key={h} href={h} className={cx('flex min-h-[42px] items-center justify-between rounded-ctl px-3 text-[14.5px] font-semibold', v === key ? 'bg-white/15' : 'text-white/75 hover:bg-white/10')}>{l}{k && counts[k] ? <span className="num rounded-full bg-action px-2 text-[12px]">{counts[k]}</span> : null}</a>; })}</nav>
        <a href="/inicio" className="m-3 rounded-ctl px-3 py-2 text-[13px] text-white/60 hover:bg-white/10">← Voltar ao painel</a>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <nav className="mb-4 flex gap-1 overflow-x-auto md:hidden">{NAV.map(([h, l]) => <a key={h} href={h} className="flex-none rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold">{l}</a>)}</nav>
        {children}
      </main>
    </div>
  );
}
