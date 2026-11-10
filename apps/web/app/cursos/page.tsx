'use client';
import { useEffect, useState } from 'react';
import { get, ApiError } from '@/lib/api';
import { Skeleton, Logo, Initials, Empty } from '@/components/ui';

/** Vitrine estilo streaming (5.5). */
export default function Cursos() {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { get<any[]>('/v1/members/courses').then(setList).catch((e: ApiError) => { if (e.status === 401) location.href = '/minhas-compras/entrar'; }); }, []);
  return (
    <main className="min-h-screen bg-[#120B26] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4"><span className="[&_*]:text-white"><Logo /></span><nav className="flex gap-1 text-[14.5px] font-semibold"><a href="/cursos" className="px-3 py-2">Meus cursos</a><a href="/minhas-compras" className="px-3 py-2 text-white/70">Minhas compras</a></nav></header>
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h1 className="mb-5 text-[24px] font-extrabold">Continue de onde parou</h1>
        {!list ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{[0, 1, 2].map(i => <Skeleton key={i} className="aspect-[3/4] w-full opacity-20" />)}</div>
          : list.length === 0 ? <Empty title="Você ainda não tem cursos." /> :
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {list.map(c => (
              <a key={c.id} href={c.type === 'service' && c.service_url ? c.service_url : `/curso/${c.id}`} className="group overflow-hidden rounded-card bg-white/5 ring-1 ring-white/10 transition hover:ring-[#8F7BFF]">
                <div className="flex aspect-[3/4] items-center justify-center bg-gradient-to-br from-[#5B3FE6] to-[#1A1033]">{c.cover_url ? <img src={c.cover_url} alt="" className="h-full w-full object-cover" /> : <Initials name={c.name} size={88} />}</div>
                <div className="p-3"><p className="line-clamp-2 font-bold leading-tight">{c.name}</p><p className="mt-0.5 text-[13px] text-white/60">{c.school}</p>
                  {c.type !== 'file' && <div className="mt-2 h-1.5 rounded-full bg-white/15"><div className="h-full rounded-full bg-[#8F7BFF]" style={{ width: `${c.progress_pct}%` }} /></div>}</div>
              </a>
            ))}
          </div>}
      </section>
    </main>
  );
}
