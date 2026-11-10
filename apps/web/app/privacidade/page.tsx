import { Logo } from '@/components/ui';
export const metadata = { title: 'Política de Privacidade' };
export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10"><Logo /><h1 className="mt-6 text-[26px] font-extrabold">Política de Privacidade</h1>
      <p className="mt-4 rounded-ctl border border-warn-line bg-warn-soft p-4 text-[14.5px]">Rascunho de estrutura. O texto final precisa ser escrito e validado pelo jurídico antes do lançamento (seção 12 do descritivo).</p>
      <p className="mt-4 text-ink-soft">Versão 2026-11-01 · O aceite eletrônico é registrado com versão, data, IP e navegador.</p>
    </main>
  );
}
