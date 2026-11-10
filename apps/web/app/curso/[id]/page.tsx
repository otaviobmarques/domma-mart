'use client';
import { use, useEffect, useState } from 'react';
import { get, ApiError } from '@/lib/api';
import { Card, Skeleton, Banner, Logo } from '@/components/ui';

/** Entrada do curso: abre a próxima aula liberada; para arquivo mostra os downloads. */
export default function Curso({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    get(`/v1/members/products/${id}`).then(x => {
      if (x.product.type === 'file') return setD(x);
      const all = x.modules.flatMap((m: any) => m.lessons).filter((l: any) => !l.locked);
      const next = all.find((l: any) => !l.completed) ?? all[0];
      if (next) location.replace(`/curso/${id}/aula/${next.id}`); else setD(x);
    }).catch((e: ApiError) => { if (e.status === 401) location.href = '/minhas-compras/entrar'; else setErr(e); });
  }, [id]);
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 py-6">
      <div className="mb-5 flex justify-between"><Logo className="text-[15px]" /><a href="/minhas-compras" className="font-semibold text-action">Minhas compras</a></div>
      {err ? <Banner tone="bad" action={<a href="/minhas-compras" className="font-bold underline">Ver minhas compras</a>}>{err.title === 'Seu acesso a este curso terminou.' || err.status === 403 ? 'Seu acesso a este curso terminou.' : err.title}</Banner>
        : !d ? <Skeleton className="h-40 w-full" /> : (
          <Card>
            <h1 className="text-[21px] font-extrabold">{d.product.name}</h1>
            {d.files.length ? <ul className="mt-4 space-y-2">{d.files.map((f: any) => <li key={f.id}><a href={f.url} className="flex min-h-[52px] items-center justify-between rounded-ctl border border-line px-4 font-semibold hover:border-action"><span className="truncate">{f.filename}</span><span className="text-action">Baixar</span></a></li>)}</ul> : <p className="mt-2 text-ink-mute">O conteúdo ainda está sendo preparado.</p>}
          </Card>
        )}
    </main>
  );
}
