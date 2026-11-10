'use client';
import { use, useEffect, useRef, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { brl } from '@/lib/format';
import { Button, CopyButton, Skeleton, Banner, Logo, Spinner } from '@/components/ui';

type Pix = { order_id: string; code: string; status: string; total_cents: number; product_name: string; qr: string; copy_paste: string; expires_at: string; server_now: string; sandbox: { charge_id: string } | null; redirect_url: string | null };

export default function PixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [t] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(location.search).get('t') ?? '' : ''));
  const [pix, setPix] = useState<Pix | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const skew = useRef(0);

  async function load() {
    try {
      const p = await get<Pix>(`/v1/orders/${id}/pix?t=${encodeURIComponent(t)}`);
      skew.current = new Date(p.server_now).getTime() - Date.now(); // contagem pelo relógio do servidor
      setPix(p);
      if (p.status === 'paid' && p.redirect_url) location.href = p.redirect_url;
    } catch (e) { setErr(e as ApiError); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // SSE; se falhar, consulta a cada 3 s
  useEffect(() => {
    if (!pix || pix.status === 'paid') return;
    let poll: any = null;
    const es = new EventSource(`/v1/orders/${id}/events?t=${encodeURIComponent(t)}`);
    es.addEventListener('status', (ev) => {
      setOffline(false);
      const d = JSON.parse((ev as MessageEvent).data);
      if (d.status === 'paid') location.href = d.redirect_url;
      else setPix(p => p && { ...p, status: d.status });
    });
    es.onerror = () => {
      es.close();
      if (!poll) poll = setInterval(async () => {
        try { const p = await get<Pix>(`/v1/orders/${id}/pix?t=${encodeURIComponent(t)}`); setOffline(false); if (p.status === 'paid' && p.redirect_url) location.href = p.redirect_url; else setPix(x => x && { ...x, status: p.status }); }
        catch (e) { if ((e as ApiError).status === 0) setOffline(true); }
      }, 3000);
    };
    return () => { es.close(); if (poll) clearInterval(poll); };
  }, [pix?.order_id, pix?.expires_at, id, t]);

  useEffect(() => {
    if (!pix) return;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(pix.expires_at).getTime() - (Date.now() + skew.current)) / 1000)));
    tick();
    const x = setInterval(tick, 1000);
    return () => clearInterval(x);
  }, [pix]);

  async function renew() {
    setRenewing(true);
    try { const r = await post<any>(`/v1/orders/${id}/pix/renew?t=${encodeURIComponent(t)}`); location.href = r.next.url; }
    catch (e) { setErr(e as ApiError); setRenewing(false); }
  }
  async function simulate() {
    try { await post(`/v1/dev/sandbox/orders/${id}/pay`, { t }); } catch (e) { alert((e as ApiError).title); }
  }

  if (err) return <Wrap><Banner tone="bad">{err.code === 'AUTH_LINK_EXPIRED' ? 'Este link expirou. Abra o link que enviamos por e-mail.' : err.title}</Banner></Wrap>;
  if (!pix) return <Wrap><div className="space-y-4 rounded-card bg-white p-6"><Skeleton className="h-7 w-3/4" /><Skeleton className="mx-auto h-[232px] w-[232px]" /><Skeleton className="h-14 w-full" /></div></Wrap>;

  const expired = pix.status === 'expired' || left === 0;
  if (expired) return (
    <Wrap>
      <div className="rounded-card border border-line bg-white p-6 text-center shadow-card">
        <p className="text-[20px] font-extrabold">Este Pix expirou.</p>
        <p className="mt-1 text-ink-mute">Gere um novo código para pagar {brl(pix.total_cents)}.</p>
        <Button size="xl" full className="mt-6" loading={renewing} onClick={renew}>Gerar novo Pix</Button>
      </div>
    </Wrap>
  );

  const mm = String(Math.floor((left ?? 0) / 60)).padStart(2, '0'), ss = String((left ?? 0) % 60).padStart(2, '0');
  return (
    <Wrap>
      <div className="rounded-card border border-line bg-white p-6 shadow-card">
        <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:justify-between">
          <div><h1 className="text-[21px] font-extrabold leading-tight">Pague para liberar seu acesso</h1><p className="mt-1 text-ink-mute">Abra o app do seu banco e escaneie o código.</p></div>
          <span className="num flex-none rounded-full bg-warn-soft px-3 py-1 text-[13.5px] font-bold text-[#7A4500]" aria-live="off">Expira em {mm}:{ss}</span>
        </div>

        <div className="mt-6 flex flex-col">
          {/* No celular, copia-e-cola vem primeiro (mais usado) */}
          <div className="order-2 mt-5 sm:order-1 sm:mt-0 sm:mb-5 flex justify-center">
            <img src={pix.qr} alt="QR Code do Pix" width={232} height={232} className="rounded-ctl border border-line" />
          </div>
          <div className="order-1 sm:order-2">
            <p className="mb-1.5 text-[14px] font-semibold">Pix copia e cola</p>
            <p id="copy-src" className="num max-h-24 select-all overflow-auto break-all rounded-ctl bg-canvas p-3 text-[12.5px] text-ink-soft">{pix.copy_paste}</p>
            <div className="mt-3"><CopyButton text={pix.copy_paste} label="Copiar código" done="Código copiado" variant="primary" size="xl" full /></div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-ctl bg-action-soft/60 px-4 py-3 text-[14.5px] font-semibold text-action-ink" role="status">
          <Spinner className="text-action" /> Aguardando pagamento… a tela atualiza sozinha
        </div>
        {offline && <p className="mt-3 text-[14px] text-ink-mute">Sem conexão. Assim que voltar, confirmamos seu pagamento.</p>}
        <div className="mt-5 flex justify-between border-t border-line pt-4 text-[15px]"><span className="truncate pr-4">{pix.product_name}</span><span className="num font-bold">{brl(pix.total_cents)}</span></div>
        {pix.sandbox && <Button variant="ghost" full className="mt-4" onClick={simulate}>Simular pagamento (ambiente de teste)</Button>}
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-[520px] px-4 py-6"><div className="mb-4 flex justify-center"><Logo className="text-[15px] text-ink-soft" /></div>{children}</main>;
}
