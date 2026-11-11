'use client';
import { use, useEffect, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { brl, methodLabel } from '@/lib/format';
import { track } from '@/lib/pixels';
import { Button, Card, Skeleton, Banner, Logo, CopyButton } from '@/components/ui';
import { UpsellCard, type FunnelState } from '@/components/upsell-card';

type Thanks = { order_id: string; code: string; status: string; method: string; total_cents: number; installments: number; email: string; product: { id: string; name: string; type: string; service_url: string | null }; items: { name: string; kind: string; price_cents: number }[]; boleto: { line: string; url: string; due_at: string } | null; thank_you_url: string | null; fire_purchase: boolean; login_token: string | null; login_url?: string | null; access_by_email?: boolean; sandbox: { charge_id: string } | null };

export default function Obrigado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [t] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(location.search).get('t') ?? '' : ''));
  const [d, setD] = useState<Thanks | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [funnel, setFunnel] = useState<FunnelState | null>(null);

  async function load() {
    try {
      const x = await get<Thanks>(`/v1/orders/${id}?t=${encodeURIComponent(t)}`);
      // upsell/downsell com 1 clique: aparece antes de levar à página de obrigado própria do produtor
      const f = x.status === 'paid' ? await get<FunnelState>(`/v1/orders/${id}/upsell?t=${encodeURIComponent(t)}`).catch(() => null) : null;
      if (x.status === 'paid' && x.thank_you_url && !f?.step) { goExternal(x); return; }
      setFunnel(f);
      setD(x);
      // Purchase disparado uma única vez por pedido (o servidor controla)
      if (x.fire_purchase) track('Purchase', { value: x.total_cents / 100, eventId: `purchase_${x.order_id}` });
    } catch (e) { const er = e as ApiError; if (er.code === 'AUTH_LINK_EXPIRED') location.href = '/minhas-compras/entrar'; else setErr(er); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  // cartão: confirmação chega por webhook em instantes
  useEffect(() => { if (d && d.status === 'pending' && d.method === 'card') { const x = setTimeout(load, 1500); return () => clearTimeout(x); } /* eslint-disable-next-line */ }, [d]);

  function goExternal(x: Thanks) { location.href = `${x.thank_you_url}${x.thank_you_url!.includes('?') ? '&' : '?'}order_id=${x.order_id}&status=paid`; }

  async function access() {
    if (!d) return;
    if (d.product.type === 'service' && d.product.service_url) { window.open(d.product.service_url, '_blank'); return; }
    setBusy(true);
    try {
      if (d.login_url) { location.href = d.login_url; return; } // domínio próprio: entra no endereço principal
      if (d.login_token) await post('/v1/customer/auth/order-login', { token: d.login_token });
      location.href = d.product.type === 'course' || d.product.type === 'subscription' ? `/curso/${d.product.id}` : '/minhas-compras';
    } catch { location.href = '/minhas-compras/entrar'; }
  }

  if (err) return <Wrap><Banner tone="bad">{err.title}</Banner></Wrap>;
  if (!d) return <Wrap><Card className="space-y-4"><Skeleton className="mx-auto h-16 w-16 rounded-full" /><Skeleton className="h-7 w-2/3" /><Skeleton className="h-24 w-full" /></Card></Wrap>;

  if (d.status !== 'paid') {
    return (
      <Wrap>
        <Card>
          <h1 className="text-[21px] font-extrabold">Recebemos seu pedido.</h1>
          {d.method === 'boleto' ? (
            <>
              <p className="mt-1 text-ink-soft">Assim que o boleto compensar, enviamos o acesso para <b>{d.email}</b>.</p>
              {d.boleto && (
                <div className="mt-5 space-y-3">
                  <p className="text-[14px] font-semibold">Código de barras</p>
                  <p id="copy-src" className="num break-all rounded-ctl bg-canvas p-3 text-[13px]">{d.boleto.line}</p>
                  <CopyButton text={d.boleto.line} label="Copiar código" done="Código copiado" variant="primary" size="lg" full />
                  <a href={d.boleto.url} target="_blank" className="flex min-h-[48px] items-center justify-center rounded-ctl border border-line font-bold">Baixar boleto (PDF)</a>
                  <p className="text-[14px] text-ink-mute">Vence em {new Date(d.boleto.due_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. O boleto leva até 3 dias úteis para compensar.</p>
                </div>
              )}
              {d.sandbox && <Button variant="ghost" full className="mt-4" onClick={async () => { await post(`/v1/dev/sandbox/orders/${id}/pay`, { t }); setTimeout(load, 1200); }}>Simular compensação (ambiente de teste)</Button>}
            </>
          ) : <p className="mt-1 text-ink-soft">Estamos confirmando seu pagamento…</p>}
        </Card>
      </Wrap>
    );
  }

  const cta = d.product.type === 'file' ? 'Baixar arquivo' : d.product.type === 'service' ? 'Agendar meu horário' : 'Acessar meu curso';
  return (
    <Wrap>
      <Card className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ok-soft" aria-hidden="true"><svg viewBox="0 0 24 24" className="h-9 w-9 text-ok" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
        <h1 className="mt-4 text-[24px] font-extrabold">Compra aprovada</h1>
        <p className="mt-1 text-ink-soft">Enviamos o acesso para <b>{d.email}</b> e para o seu WhatsApp.</p>
        <div className="mt-6 rounded-ctl bg-canvas p-4 text-left text-[15px]">
          <div className="flex justify-between"><span className="text-ink-mute">Pedido</span><span className="num font-semibold">#{d.code}</span></div>
          {d.items.map((i, k) => <div key={k} className="mt-1 flex justify-between gap-4"><span className="truncate">{i.name}</span><span className="num">{brl(i.price_cents)}</span></div>)}
          <div className="mt-1 flex justify-between"><span className="text-ink-mute">Pagamento</span><span>{methodLabel(d.method)}{d.installments > 1 ? ` em ${d.installments}x` : ''}</span></div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 font-bold"><span>Total</span><span className="num">{brl(d.total_cents)}</span></div>
        </div>
        <Button size="xl" full className="mt-6" loading={busy} onClick={access}>{cta}</Button>
        {d.access_by_email && d.product.type !== 'service' && <p className="mt-3 text-center text-[14px] text-ink-mute">Você já tem conta aqui. Se não estiver conectado, entre na sua área de cliente com o e-mail <b>{d.email}</b> — mandamos um link de acesso para ele.</p>}
      </Card>
      {funnel && (funnel.step || funnel.accepted.length > 0) && <div className="mt-4"><UpsellCard orderId={id} t={t} initial={funnel} onDone={() => { if (d.thank_you_url) goExternal(d); }} /></div>}
      <Card className="mt-4">
        <p className="font-bold">Precisa de ajuda?</p>
        <p className="mt-1 text-[14.5px] text-ink-soft">Na sua área de cliente você vê suas compras, baixa o recibo, pede reembolso dentro da garantia e fala com o produtor. Não precisa de senha.</p>
        <a href="/minhas-compras/entrar" className="mt-3 inline-flex min-h-[44px] items-center font-bold text-action">Abrir minha área de cliente →</a>
      </Card>
    </Wrap>
  );
}
function Wrap({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-[520px] px-4 py-6"><div className="mb-4 flex justify-center"><Logo className="text-[15px] text-ink-soft" /></div>{children}</main>;
}
