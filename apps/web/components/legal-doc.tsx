import { Logo } from '@/components/ui';
import { LEGAL } from '@/lib/legal';

/** Valor da empresa ou marcador visível de pendência. */
export function V({ v, label }: { v: string; label: string }) {
  return v ? <>{v}</> : <mark className="rounded bg-warn-soft px-1 font-semibold text-[#7A4500]">[{label} — a preencher]</mark>;
}

export type Section = { id: string; title: string; body: React.ReactNode };

export function LegalDoc({ title, intro, sections }: { title: string; intro: React.ReactNode; sections: Section[] }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-[15.5px] leading-relaxed text-ink">
      <a href="/" aria-label="Início"><Logo /></a>
      <h1 className="mt-6 text-[28px] font-extrabold leading-tight">{title}</h1>
      <p className="mt-1 text-[14px] text-ink-mute">Versão {LEGAL.version} · atualizada em {LEGAL.updatedAt}</p>
      <div className="mt-4 space-y-3 text-ink-soft">{intro}</div>
      <nav aria-label="Nesta página" className="mt-6 rounded-card border border-line bg-white p-4">
        <p className="text-[13.5px] font-bold uppercase tracking-wide text-ink-mute">Nesta página</p>
        <ol className="mt-2 grid gap-1 text-[14.5px] sm:grid-cols-2">{sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="text-action hover:underline">{i + 1}. {s.title}</a></li>)}</ol>
      </nav>
      {sections.map((s, i) => (
        <section key={s.id} id={s.id} className="mt-8 scroll-mt-6">
          <h2 className="text-[19px] font-extrabold">{i + 1}. {s.title}</h2>
          <div className="legal mt-2 space-y-3">{s.body}</div>
        </section>
      ))}
      <footer className="mt-10 border-t border-line pt-4 text-[13.5px] text-ink-mute">
        <V v={LEGAL.company} label="Razão social" /> · CNPJ <V v={LEGAL.cnpj} label="CNPJ" /> · <V v={LEGAL.address} label="Endereço" /><br />
        Outros documentos: <a href="/termos" className="underline">Termos de Uso</a> · <a href="/privacidade" className="underline">Política de Privacidade</a> · <a href="/produtos-proibidos" className="underline">Produtos Proibidos</a>
      </footer>
    </main>
  );
}
