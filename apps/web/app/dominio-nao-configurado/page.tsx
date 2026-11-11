import { Logo } from '@/components/ui';
export const metadata = { title: 'Página não encontrada' };
export default function Page() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <Logo />
      <h1 className="mt-6 text-[22px] font-extrabold">Não encontramos esta página</h1>
      <p className="mt-2 text-ink-soft">Confira o link que você recebeu do vendedor.</p>
      <a href="/minhas-compras/entrar" className="mt-6 inline-flex min-h-[48px] items-center rounded-ctl bg-action px-5 font-bold text-white">Acessar minhas compras</a>
    </main>
  );
}
