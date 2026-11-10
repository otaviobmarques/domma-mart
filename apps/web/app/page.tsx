import { Logo } from '@/components/ui';
export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5"><Logo /><nav className="flex gap-1 text-[14.5px] font-semibold"><a href="/minhas-compras/entrar" className="px-3 py-2 text-ink-soft">Minhas compras</a><a href="/entrar" className="px-3 py-2">Entrar</a></nav></header>
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-10 md:pt-20">
        <p className="text-[13px] font-extrabold uppercase tracking-[0.2em] text-action">Para quem vende online</p>
        <h1 className="mt-3 max-w-3xl text-[40px] font-extrabold leading-[1.05] md:text-[60px]">Venda seus cursos e e-books com Pix na hora.</h1>
        <p className="mt-5 max-w-xl text-[18px] text-ink-soft">Checkout rápido, área de membros, afiliados e recuperação de vendas pelo WhatsApp. Seu primeiro produto à venda em menos de 10 minutos.</p>
        <div className="mt-8 flex flex-wrap gap-3"><a href="/criar-conta" className="inline-flex min-h-[56px] items-center rounded-ctl bg-action px-7 text-[17px] font-bold text-white hover:bg-action-hover">Criar conta grátis</a><a href="/pay/confeitaria" className="inline-flex min-h-[56px] items-center rounded-ctl border border-line bg-white px-7 text-[17px] font-bold">Ver um checkout</a></div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {[['4,49% + R$ 1,49', 'Uma taxa só para Pix, cartão e boleto. No Pix, nunca passa de R$ 14,90. Sem mensalidade.'], ['Saque grátis', 'Por Pix, uma vez por dia. Pix: 90% disponível no dia seguinte.'], ['WhatsApp nativo', 'Lembramos quem gerou o Pix e não pagou — sem integração extra.']].map(([t, d]) => <div key={t} className="rounded-card border border-line bg-white p-6 shadow-card"><p className="num text-[22px] font-bold text-action">{t}</p><p className="mt-2 text-ink-soft">{d}</p></div>)}
        </div>
      </section>
    </main>
  );
}
