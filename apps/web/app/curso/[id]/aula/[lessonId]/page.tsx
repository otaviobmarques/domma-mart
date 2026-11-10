'use client';
import { use, useEffect, useRef, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { Button, Skeleton, Logo, cx } from '@/components/ui';

export default function Aula({ params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = use(params);
  const [outline, setOutline] = useState<any>(null);
  const [l, setL] = useState<any>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [cert, setCert] = useState<string | null>(null);
  const [wm, setWm] = useState({ x: 8, y: 10 });
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const loadOutline = () => get(`/v1/members/products/${id}`).then(o => { setOutline(o); setCert(o.certificate_code); });
  async function loadLesson() {
    setErr(null); setL(null);
    try { setL(await get(`/v1/members/lessons/${lessonId}/playback`)); }
    catch (e) { const x = e as ApiError; if (x.status === 401) location.href = '/minhas-compras/entrar'; setErr(x); }
  }
  useEffect(() => { loadOutline().catch(() => {}); loadLesson(); /* eslint-disable-next-line */ }, [id, lessonId]);

  // marca d'água muda de posição a cada 30 s (RN-92)
  useEffect(() => { const t = setInterval(() => setWm({ x: 5 + Math.random() * 55, y: 5 + Math.random() * 75 }), 30_000); return () => clearInterval(t); }, []);
  // progresso a cada 15 s
  useEffect(() => {
    const t = setInterval(() => { const v = video.current; if (v && !v.paused) post(`/v1/members/lessons/${lessonId}/progress`, { position_sec: Math.floor(v.currentTime) }).catch(() => {}); }, 15_000);
    return () => clearInterval(t);
  }, [lessonId]);
  // URL assinada vale 2 h: renova antes de expirar mantendo a posição
  useEffect(() => {
    if (!l?.media_url) return;
    const t = setTimeout(async () => { const pos = video.current?.currentTime ?? 0; const n = await get(`/v1/members/lessons/${lessonId}/playback`); setL(n); setTimeout(() => { if (video.current) video.current.currentTime = pos; }, 300); }, (l.media_expires_in - 120) * 1000);
    return () => clearTimeout(t);
  }, [l?.media_url, lessonId, l?.media_expires_in]);

  async function complete() {
    setBusy(true);
    const r = await post<any>(`/v1/members/lessons/${lessonId}/complete`);
    if (r.certificate_code) setCert(r.certificate_code);
    await loadOutline();
    setBusy(false);
    if (l?.next_id) location.href = `/curso/${id}/aula/${l.next_id}`;
  }

  const deviceLimit = err?.data?.code_detail === 'DEVICE_LIMIT';
  const noAccess = err?.data?.code_detail === 'NO_ACCESS';
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3"><Logo iconOnlyOnMobile className="whitespace-nowrap text-[15px]" /><span className="hidden truncate text-ink-mute sm:block">{outline?.product.school}</span></div>
          <nav className="flex overflow-x-auto whitespace-nowrap text-[13.5px] font-semibold sm:text-[14px]"><a href="/cursos" className="px-2.5 py-2">Meus cursos</a><span className="hidden px-2.5 py-2 text-ink-mute md:block" title="Em breve">Comunidade</span><a href={cert ? `/certificado/${cert}` : '#certificados'} className={cx('px-2.5 py-2', !cert && 'text-ink-mute')}>Certificados</a><a href="/minhas-compras" className="px-2.5 py-2">Minhas compras</a></nav>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1fr_340px]">
        <section>
          {noAccess ? <Msg title="Seu acesso a este curso terminou." action={<a href="/minhas-compras" className="font-bold text-action">Ver minhas compras</a>} />
            : deviceLimit ? <Msg title="Este curso já está aberto em 2 aparelhos. Feche em um deles para continuar." action={<Button onClick={async () => { await post(`/v1/members/products/${id}/end-other-sessions`); loadLesson(); }}>Encerrar outras sessões</Button>} />
            : err ? <Msg title={err.title} />
            : !l ? <Skeleton className="aspect-video w-full" />
            : (
              <>
                {l.kind === 'video' || l.kind === 'audio' ? (
                  l.status !== 'ready' ? <Msg title="Esta aula ainda está sendo preparada. Volte em alguns minutos." /> :
                  <div className="relative aspect-video overflow-hidden rounded-card bg-black" onContextMenu={e => e.preventDefault()}>
                    <video ref={video} key={l.media_url} src={l.media_url} controls controlsList="nodownload noplaybackrate" disablePictureInPicture playsInline className="h-full w-full"
                      onLoadedMetadata={e => { if (l.position_sec) e.currentTarget.currentTime = l.position_sec; }}
                      onPause={e => post(`/v1/members/lessons/${lessonId}/progress`, { position_sec: Math.floor(e.currentTarget.currentTime) }).catch(() => {})} />
                    <span className="pointer-events-none absolute select-none text-[12px] font-semibold text-white/35 transition-all duration-[2000ms]" style={{ left: `${wm.x}%`, top: `${wm.y}%` }} aria-hidden="true">{l.watermark}</span>
                  </div>
                ) : l.kind === 'pdf' ? (
                  <div className="relative overflow-hidden rounded-card border border-line bg-white"><iframe src={`${l.media_url}#toolbar=0`} className="h-[75vh] w-full" title={l.title} /><span className="pointer-events-none absolute right-3 top-3 text-[12px] text-ink/30" aria-hidden="true">{l.watermark}</span></div>
                ) : (
                  <article className="rounded-card border border-line bg-white p-6 text-[16px] leading-relaxed whitespace-pre-wrap">{l.kind === 'link' ? <a href={l.body} target="_blank" rel="noopener" className="font-bold text-action underline">{l.body}</a> : l.body}</article>
                )}
                <p className="mt-5 text-[12.5px] font-extrabold uppercase tracking-wider text-action">Módulo {l.module_position} · Aula {l.lesson_position}</p>
                <h1 className="mt-1 text-[24px] font-extrabold leading-tight">{l.title}</h1>
                <div className="mt-5 flex flex-wrap gap-2">
                  {l.prev_id && <Button variant="secondary" onClick={() => (location.href = `/curso/${id}/aula/${l.prev_id}`)}>← Aula anterior</Button>}
                  <Button loading={busy} onClick={complete}>{l.next_id ? 'Concluir e avançar →' : 'Concluir aula'}</Button>
                </div>
                {l.attachments?.length > 0 && <div className="mt-6"><p className="mb-2 font-bold">Materiais</p><ul className="space-y-2">{l.attachments.map((a: any, i: number) => <li key={i}><a href={a.url} className="flex min-h-[48px] items-center rounded-ctl border border-line bg-white px-4 font-semibold text-action">{a.name}</a></li>)}</ul></div>}
                <p className="mt-6 text-[14px] text-ink-mute">Comentários chegam em breve.</p>
                {cert && <div className="mt-6 rounded-card border border-ok/30 bg-ok-soft p-4"><p className="font-bold text-ok">Parabéns! Você concluiu o curso.</p><a href={`/certificado/${cert}`} className="mt-1 inline-block font-bold text-action underline">Ver meu certificado</a></div>}
              </>
            )}
        </section>
        <aside className="h-fit rounded-card border border-line bg-white p-4 lg:sticky lg:top-20">
          {outline ? <>
            <p className="font-extrabold leading-tight">{outline.product.name}</p>
            <div className="mt-3 flex items-center gap-3"><div className="h-2 flex-1 rounded-full bg-canvas"><div className="h-full rounded-full bg-action" style={{ width: `${outline.progress_pct}%` }} /></div><span className="num text-[13px] font-bold">{outline.progress_pct}%</span></div>
            <nav className="mt-4 space-y-4" aria-label="Aulas">
              {outline.modules.map((m: any) => (
                <div key={m.id}><p className="mb-1 text-[12.5px] font-extrabold uppercase tracking-wide text-ink-mute">{m.title}</p>
                  <ul>{m.lessons.map((x: any) => (
                    <li key={x.id}>{x.locked ? <span className="flex min-h-[40px] items-center gap-2 px-2 text-[14px] text-ink-mute">🔒 {x.title} <span className="text-[12.5px]">(libera em {x.unlock_in_days} dias)</span></span> :
                      <a href={`/curso/${id}/aula/${x.id}`} aria-current={x.id === lessonId ? 'page' : undefined} className={cx('flex min-h-[40px] items-center gap-2 rounded-ctl px-2 text-[14px]', x.id === lessonId ? 'bg-action-soft font-bold text-action-ink' : 'hover:bg-canvas')}>
                        <span className={cx('h-2.5 w-2.5 flex-none rounded-full', x.completed ? 'bg-ok' : 'border-2 border-line')} aria-label={x.completed ? 'concluída' : undefined} />{x.title}</a>}</li>
                  ))}</ul></div>
              ))}
            </nav>
          </> : <Skeleton className="h-64 w-full" />}
        </aside>
      </div>
    </div>
  );
}
function Msg({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-card border border-line bg-white p-6 text-center"><p className="max-w-md text-[17px] font-bold">{title}</p>{action}</div>;
}
