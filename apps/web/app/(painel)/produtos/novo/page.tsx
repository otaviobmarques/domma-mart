'use client';
import { useEffect, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { brl, maskMoney, moneyToCents } from '@/lib/format';
import { netCents } from '@/lib/fees';
import { uploadFile } from '@/lib/upload';
import { Button, Card, Field, Banner, CopyButton, cx } from '@/components/ui';

const TYPES = [
  { v: 'course', t: 'Curso online', d: 'Aulas em vídeo, PDF ou texto na área de membros.' },
  { v: 'file', t: 'E-book ou arquivo', d: 'O cliente baixa depois de pagar.' },
  { v: 'service', t: 'Mentoria ou serviço', d: 'Você envia o link de agendamento.' },
  { v: 'subscription', t: 'Assinatura', d: 'Cobrança automática todo mês, trimestre ou ano.' },
];
type Up = { name: string; pct: number; status: 'Enviando' | 'Processando' | 'Pronto' | 'Erro'; file: File; error?: string };

export default function NovoProduto() {
  const [step, setStep] = useState(1);
  const [type, setType] = useState('course');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [interval, setInterval] = useState('month');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<{ product_id: string; offer_id: string } | null>(null);
  const [ups, setUps] = useState<Up[]>([]);
  const [serviceUrl, setServiceUrl] = useState('');
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const cents = moneyToCents(price);

  // rascunho salvo: retoma produto criado se o navegador fechar
  useEffect(() => {
    const d = sessionStorage.getItem('dm_new_product');
    if (d) { const x = JSON.parse(d); setProduct(x.product); setType(x.type); setName(x.name); setPrice(x.price); setStep(x.product ? 2 : 1); }
  }, []);
  useEffect(() => { sessionStorage.setItem('dm_new_product', JSON.stringify({ product, type, name, price })); }, [product, type, name, price]);

  async function next1(e: React.FormEvent) {
    e.preventDefault();
    const ee: Record<string, string> = {};
    if (name.trim().length < 3) ee.name = 'Use pelo menos 3 caracteres.';
    if (cents < 500) ee.price = 'O preço mínimo é R$ 5,00.';
    if (cents > 5_000_000) ee.price = 'Acima de R$ 50.000,00 o produto passa por análise. Fale com o suporte.';
    setErrors(ee); if (Object.keys(ee).length) return;
    setBusy(true);
    try {
      if (!product) setProduct(await post('/v1/products', { type, name: name.trim(), price_cents: cents, interval: type === 'subscription' ? interval : undefined }));
      setStep(2);
    } catch (x) { setErrors((x as ApiError).fields ?? {}); setErr((x as ApiError).title); }
    setBusy(false);
  }

  async function addFiles(files: FileList | null) {
    if (!files || !product) return;
    const list = Array.from(files);
    for (const f of list) {
      if (f.size > 5 * 1024 ** 3) { setUps(u => [...u, { name: f.name, pct: 0, status: 'Erro', file: f, error: 'O arquivo passa de 5 GB. Divida em partes menores.' }]); continue; }
      setUps(u => [...u, { name: f.name, pct: 0, status: 'Enviando', file: f }]);
    }
    for (const f of list.filter(f => f.size <= 5 * 1024 ** 3)) await send(f);
  }
  async function send(f: File) {
    const set = (p: Partial<Up>) => setUps(u => u.map(x => (x.file === f ? { ...x, ...p } : x)));
    set({ status: 'Enviando', pct: 0, error: undefined });
    try {
      await uploadFile(f, product!.product_id, { onProgress: pct => set({ pct, status: pct === 100 ? 'Processando' : 'Enviando' }) });
      set({ status: 'Pronto', pct: 100 });
    } catch (e) { set({ status: 'Erro', error: (e as Error).message }); }
  }

  async function publish() {
    setBusy(true); setErr(null);
    try {
      if (type === 'service') await fetch(`/v1/products/${product!.product_id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-requested-with': 'domma' }, body: JSON.stringify({ service_url: serviceUrl }) });
      setResult(await post(`/v1/products/${product!.product_id}/publish`));
      sessionStorage.removeItem('dm_new_product');
      setStep(3);
    } catch (x) { setErr((x as ApiError).title); }
    setBusy(false);
  }

  const ready = ups.some(u => u.status === 'Pronto');
  const canPublish = type === 'service' ? /^https?:\/\//.test(serviceUrl) : ready;
  const wa = result?.checkout_url ? `https://wa.me/?text=${encodeURIComponent(`Olha o que eu preparei pra você: ${name} — ${result.checkout_url}`)}` : '#';

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[26px] font-extrabold">Criar produto</h1>
      <ol className="mt-4 flex gap-2" aria-label="Passos">
        {['1. Produto', '2. Conteúdo', '3. Link de venda'].map((l, i) => <li key={l} aria-current={step === i + 1 ? 'step' : undefined} className={cx('rounded-full px-3 py-1 text-[13.5px] font-bold', step > i + 1 ? 'bg-ok-soft text-ok' : step === i + 1 ? 'bg-action text-white' : 'bg-white text-ink-mute ring-1 ring-line')}>{step > i + 1 ? '✓ ' : ''}{l}</li>)}
      </ol>

      {step === 1 && (
        <form onSubmit={next1} noValidate><Card className="mt-5 space-y-5">
          <fieldset><legend className="mb-2 font-semibold">O que você vai vender?</legend>
            <div className="grid gap-2 sm:grid-cols-2">{TYPES.map(t => (
              <label key={t.v} className={cx('cursor-pointer rounded-ctl border-2 p-3', type === t.v ? 'border-action bg-action-soft/40' : 'border-line hover:border-action/40')}>
                <input type="radio" name="type" className="sr-only" checked={type === t.v} onChange={() => setType(t.v)} disabled={!!product} />
                <span className="block font-bold">{t.t}</span><span className="block text-[13.5px] text-ink-mute">{t.d}</span>
              </label>))}</div>
          </fieldset>
          <Field label="Nome do produto" value={name} onChange={e => setName(e.target.value)} maxLength={90} error={errors.name} placeholder="Ex.: Curso de Confeitaria Lucrativa" />
          {type === 'subscription' && <div><p className="mb-1.5 font-semibold">Cobrança</p><div className="flex flex-wrap gap-2">{[['month', 'Mensal'], ['quarter', 'Trimestral'], ['semester', 'Semestral'], ['year', 'Anual']].map(([v, l]) => <button type="button" key={v} onClick={() => setInterval(v)} className={cx('min-h-[44px] rounded-ctl border-2 px-4 font-semibold', interval === v ? 'border-action bg-action-soft/40' : 'border-line')}>{l}</button>)}</div></div>}
          <div>
            <Field label="Preço" inputMode="numeric" value={price} onChange={e => setPrice(maskMoney(e.target.value))} error={errors.price} mono right={<span className="text-ink-mute">R$</span>} placeholder="0,00" />
            <div className="mt-3 rounded-ctl bg-ok-soft p-4" aria-live="polite">
              <p className="text-[14px] font-semibold text-ok">A cada venda você recebe</p>
              <p className="num text-[26px] font-bold text-ok">{brl(cents >= 500 ? netCents(cents) : 0)}</p>
              <p className="text-[13.5px] text-ink-soft">Taxa Domma Mart: 4,49% + R$ 1,49 por venda. Sem mensalidade.</p>
            </div>
          </div>
          <p className="text-[13.5px] text-ink-mute">Já deixamos pronto: Pix e cartão em até 12x, garantia de 7 dias e página de pagamento. Você ajusta depois, se quiser.</p>
          {err && <Banner tone="bad">{err}</Banner>}
          <div className="flex justify-end"><Button type="submit" size="lg" loading={busy}>Continuar</Button></div>
        </Card></form>
      )}

      {step === 2 && product && (
        <Card className="mt-5 space-y-5">
          {type === 'service' ? (
            <Field label="Link de agendamento ou instruções" placeholder="https://calendly.com/…" value={serviceUrl} onChange={e => setServiceUrl(e.target.value)} hint="Depois de pagar, o cliente recebe este link para marcar o horário." />
          ) : (
            <>
              <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }} className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-action/40 bg-action-soft/30 p-6 text-center hover:bg-action-soft/50">
                <input type="file" multiple={type !== 'file'} className="sr-only" accept="video/mp4,video/quicktime,application/pdf,image/*,audio/*,application/zip,application/epub+zip" onChange={e => addFiles(e.target.files)} />
                <span className="text-[17px] font-bold">Arraste seus arquivos aqui</span>
                <span className="mt-1 text-[14px] text-ink-mute">{type === 'file' ? 'PDF, e-book, imagens ou ZIP' : 'Vídeos (mp4, mov — até 5 GB cada), PDF, imagens ou áudio. Cada arquivo vira uma aula, na ordem de envio.'}</span>
                <span className="mt-3 inline-flex min-h-[44px] items-center rounded-ctl bg-white px-4 font-bold text-action ring-1 ring-line">Escolher arquivos</span>
              </label>
              {ups.length > 0 && <ul className="divide-y divide-line rounded-ctl border border-line">{ups.map((u, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0"><span className="block truncate font-semibold">{u.name}</span>{u.error && <span className="text-[13px] text-bad">{u.error}</span>}</span>
                  <span className="flex-none text-[13.5px] font-semibold">{u.status === 'Enviando' ? <span className="num text-action">Enviando {u.pct}%</span> : u.status === 'Processando' ? <span className="text-ink-mute">Processando</span> : u.status === 'Pronto' ? <span className="text-ok">✓ Pronto</span> : <button className="text-bad underline" onClick={() => send(u.file)}>Tentar de novo</button>}</span>
                </li>))}</ul>}
            </>
          )}
          {err && <Banner tone="bad">{err}</Banner>}
          <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(1)}>Voltar</Button><Button size="lg" disabled={!canPublish} loading={busy} onClick={publish}>Publicar produto</Button></div>
        </Card>
      )}

      {step === 3 && result && (
        <Card className="mt-5">
          {result.status === 'in_review' ? (
            <Banner tone="warn">Seu produto está em análise. Avisamos em até 24 h.</Banner>
          ) : (
            <>
              <p className="text-[22px] font-extrabold">Pronto! Seu link de venda:</p>
              <p className="num mt-3 break-all rounded-ctl bg-canvas p-3 text-[15px] font-semibold">{result.checkout_url}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <CopyButton text={result.checkout_url} label="Copiar link" variant="primary" full />
                <a href={wa} target="_blank" className="inline-flex min-h-[44px] items-center justify-center rounded-ctl bg-[#25D366] px-4 font-bold text-white">Enviar no WhatsApp</a>
                <a href={result.checkout_url} target="_blank" className="inline-flex min-h-[44px] items-center justify-center rounded-ctl border border-line px-4 font-bold">Ver como o cliente vê</a>
              </div>
            </>
          )}
          <details className="mt-6 rounded-ctl border border-line p-4">
            <summary className="cursor-pointer font-bold">Quer ajustar mais? (opcional)</summary>
            <ul className="mt-3 grid gap-1 text-[14.5px] sm:grid-cols-2">
              {[['preco', 'Parcelas e juros'], ['garantia', 'Garantia (7, 15, 30 dias)'], ['cupons', 'Cupons'], ['especial', 'Oferta especial'], ['afiliados', 'Afiliados'], ['socios', 'Sócios (coprodução)'], ['obrigado', 'Página de obrigado'], ['pixels', 'Pixels']].map(([k, l]) => <li key={k}><a className="flex min-h-[40px] items-center font-semibold text-action" href={`/produtos/${product!.product_id}?aba=${k}`}>{l} →</a></li>)}
            </ul>
          </details>
        </Card>
      )}
    </div>
  );
}
