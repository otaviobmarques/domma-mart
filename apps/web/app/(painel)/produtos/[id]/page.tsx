'use client';
import { use, useEffect, useState } from 'react';
import { get, post, api, ApiError } from '@/lib/api';
import { brl, maskMoney, moneyToCents, pct, shortDate } from '@/lib/format';
import { netCents } from '@/lib/fees';
import { uploadFile } from '@/lib/upload';
import { Button, Card, Field, Select, Textarea, Toggle, Banner, Pill, CopyButton, Skeleton, Modal, cx } from '@/components/ui';

const TABS = [['conteudo', 'Conteúdo'], ['preco', 'Preço e parcelas'], ['garantia', 'Garantia e limites'], ['especial', 'Oferta especial'], ['upsell', 'Upsell'], ['cupons', 'Cupons'], ['visual', 'Visual do checkout'], ['pixels', 'Pixels'], ['obrigado', 'Página de obrigado'], ['afiliados', 'Afiliados'], ['socios', 'Sócios']] as const;

export default function Produto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [p, setP] = useState<any>(null);
  const [tab, setTab] = useState<string>('conteudo');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const load = () => get(`/v1/products/${id}`).then(setP);
  useEffect(() => { load(); const a = new URLSearchParams(location.search).get('aba'); if (a) setTab(a === 'garantia' ? 'garantia' : a); }, [id]);
  if (!p) return <Skeleton className="h-96 w-full" />;
  const offer = p.offers[0];

  async function save(path: string, body: any, method = 'PATCH') {
    setMsg(null);
    try { await api(method, path, body); setMsg({ tone: 'ok', text: 'Alterações salvas.' }); await load(); return true; }
    catch (e) { const x = e as ApiError; setMsg({ tone: 'bad', text: Object.values(x.fields ?? {})[0] ?? x.title }); return false; }
  }

  return (
    <div>
      <a href="/produtos" className="text-[14px] font-semibold text-action">← Produtos</a>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-[24px] font-extrabold leading-tight">{p.name}</h1>
          <div className="mt-1 flex items-center gap-2">{p.moderation_status === 'approved' ? <Pill tone="ok">À venda</Pill> : p.moderation_status === 'in_review' ? <Pill tone="warn">Em análise</Pill> : p.moderation_status === 'rejected' ? <Pill tone="bad">Não aprovado</Pill> : <Pill>Rascunho</Pill>}{p.moderation_notes && p.moderation_status !== 'approved' && <span className="text-[13px] text-ink-mute">{p.moderation_notes}</span>}</div></div>
        <div className="flex flex-wrap gap-2">
          {p.moderation_status === 'approved' ? <><CopyButton text={offer.checkout_url} label="Copiar link de venda" /><a href={offer.checkout_url} target="_blank"><Button variant="secondary">Ver checkout</Button></a></>
            : <Button onClick={async () => { try { const r = await post(`/v1/products/${id}/publish`); setMsg({ tone: 'ok', text: r.status === 'in_review' ? 'Seu produto está em análise. Avisamos em até 24 h.' : 'Produto publicado!' }); load(); } catch (e) { setMsg({ tone: 'bad', text: (e as ApiError).title }); } }}>Publicar produto</Button>}
        </div>
      </div>
      {msg && <Banner tone={msg.tone} className="mt-4">{msg.text}</Banner>}
      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.filter(([k]) => k !== 'conteudo' || p.type !== 'service').map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setMsg(null); }} className={cx('min-h-[44px] flex-none whitespace-nowrap border-b-2 px-3 text-[14.5px] font-semibold', tab === k ? 'border-action text-action' : 'border-transparent text-ink-mute hover:text-ink')}>{l}</button>)}
      </div>
      <div className="mt-5">
        {tab === 'conteudo' && <Conteudo p={p} reload={load} setMsg={setMsg} />}
        {tab === 'preco' && <Preco offer={offer} save={save} />}
        {tab === 'garantia' && <Garantia p={p} offer={offer} save={save} />}
        {tab === 'especial' && <Especial p={p} offer={offer} save={save} />}
        {tab === 'upsell' && <Upsell p={p} offer={offer} save={save} />}
        {tab === 'cupons' && <Cupons p={p} offer={offer} reload={load} setMsg={setMsg} />}
        {tab === 'visual' && <Visual p={p} offer={offer} save={save} reload={load} />}
        {tab === 'pixels' && <Pixels offer={offer} save={save} />}
        {tab === 'obrigado' && <Obrigado offer={offer} save={save} />}
        {tab === 'afiliados' && <Afiliados p={p} save={save} reload={load} />}
        {tab === 'socios' && <Socios p={p} reload={load} setMsg={setMsg} />}
      </div>
    </div>
  );
}

function Conteudo({ p, reload, setMsg }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const [textOpen, setTextOpen] = useState<string | null>(null);
  const [t, setT] = useState({ title: '', body: '' });
  const [drip, setDrip] = useState<any>(null);
  const isFile = p.type === 'file';
  async function up(files: FileList | null, moduleId?: string) {
    if (!files) return;
    for (const f of Array.from(files)) {
      setBusy(`${f.name} — 0%`);
      try { await uploadFile(f, p.id, { moduleId, onProgress: x => setBusy(`${f.name} — ${x}%`) }); } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
    }
    setBusy(null); reload();
  }
  if (isFile) return (
    <Card>
      <h2 className="font-extrabold">Arquivos para download</h2>
      <ul className="mt-3 divide-y divide-line">{p.files.map((f: any) => <li key={f.id} className="flex min-h-[48px] items-center justify-between"><span>{f.filename}</span><span className="num text-[13px] text-ink-mute">{(f.size / 1024 / 1024).toFixed(1)} MB</span></li>)}</ul>
      <label className="mt-4 inline-flex min-h-[44px] cursor-pointer items-center rounded-ctl border border-line px-4 font-bold text-action"><input type="file" className="sr-only" onChange={e => up(e.target.files)} />+ Enviar arquivo</label>
      {busy && <p className="num mt-2 text-[14px] text-action">Enviando {busy}</p>}
    </Card>
  );
  return (
    <div className="space-y-4">
      {p.modules.map((m: any) => (
        <Card key={m.id}>
          <div className="flex items-center justify-between gap-2"><h2 className="font-extrabold">{m.title}</h2>
            <div className="flex gap-2"><label className="inline-flex min-h-[36px] cursor-pointer items-center rounded-ctl border border-line px-3 text-[14px] font-bold text-action"><input type="file" multiple className="sr-only" onChange={e => up(e.target.files, m.id)} />+ Enviar aulas</label><Button size="sm" variant="ghost" onClick={() => { setT({ title: '', body: '' }); setTextOpen(m.id); }}>+ Aula em texto</Button></div></div>
          {m.lessons.length === 0 ? <p className="mt-2 text-ink-mute">Nenhuma aula ainda.</p> : <ol className="mt-3 divide-y divide-line">{m.lessons.map((l: any, i: number) => (
            <li key={l.id} className="flex min-h-[52px] items-center justify-between gap-3">
              <span className="min-w-0"><span className="mr-2 text-[13px] font-bold text-ink-mute">{i + 1}.</span><span className="font-semibold">{l.title}</span> <Pill>{({ video: 'Vídeo', pdf: 'PDF', text: 'Texto', link: 'Link', audio: 'Áudio', file: 'Arquivo' } as any)[l.kind] ?? l.kind}</Pill>
                {(l.drip_days || l.drip_date) && <span className="ml-2 text-[13px] text-ink-mute">libera {l.drip_date ? `em ${shortDate(l.drip_date)}` : `${l.drip_days} dias após a compra`}</span>}</span>
              <span className="flex flex-none gap-1"><Button size="sm" variant="ghost" onClick={() => setDrip({ ...l, mode: l.drip_date ? 'date' : l.drip_days ? 'days' : 'none' })}>Liberação</Button><Button size="sm" variant="ghost" className="text-bad" onClick={async () => { if (confirm('Excluir esta aula?')) { await api('DELETE', `/v1/lessons/${l.id}`); reload(); } }}>Excluir</Button></span>
            </li>))}</ol>}
        </Card>
      ))}
      {busy && <Banner tone="info"><span className="num">Enviando {busy}</span></Banner>}
      <Button variant="secondary" onClick={async () => { const title = prompt('Nome do módulo'); if (title) { await post(`/v1/products/${p.id}/modules`, { title }); reload(); } }}>+ Novo módulo</Button>
      <Modal open={!!textOpen} onClose={() => setTextOpen(null)} title="Aula em texto" footer={<Button onClick={async () => { await post(`/v1/modules/${textOpen}/lessons`, { kind: 'text', ...t }); setTextOpen(null); reload(); }}>Salvar aula</Button>}>
        <Field label="Título" value={t.title} onChange={e => setT({ ...t, title: e.target.value })} />
        <Textarea label="Conteúdo" className="mt-3" value={t.body} onChange={e => setT({ ...t, body: e.target.value })} />
      </Modal>
      <Modal open={!!drip} onClose={() => setDrip(null)} title="Liberação programada" footer={<Button onClick={async () => { await api('PATCH', `/v1/lessons/${drip.id}`, { drip_days: drip.mode === 'days' ? Number(drip.drip_days) || 0 : null, drip_date: drip.mode === 'date' && drip.date ? new Date(drip.date + 'T00:00:00-03:00').toISOString() : null }); setDrip(null); reload(); }}>Salvar</Button>}>
        {drip && <>
          <Select label="Quando liberar" value={drip.mode} onChange={e => setDrip({ ...drip, mode: e.target.value })}><option value="none">Na hora da compra</option><option value="days">Dias após a compra</option><option value="date">Em uma data</option></Select>
          {drip.mode === 'days' && <Field className="mt-3" label="Dias após a compra" type="number" min={1} value={drip.drip_days ?? ''} onChange={e => setDrip({ ...drip, drip_days: e.target.value })} />}
          {drip.mode === 'date' && <Field className="mt-3" label="Data" type="date" value={drip.date ?? ''} onChange={e => setDrip({ ...drip, date: e.target.value })} />}
        </>}
      </Modal>
    </div>
  );
}

function Preco({ offer, save }: any) {
  const [price, setPrice] = useState(maskMoney(String(offer.price_cents)));
  const [max, setMax] = useState(offer.max_installments);
  const [mode, setMode] = useState(offer.installment_interest);
  const [methods, setMethods] = useState<string[]>(offer.methods);
  const [pixMin, setPixMin] = useState(offer.pix_expiration_min);
  const [boletoDays, setBoletoDays] = useState(offer.boleto_due_days);
  const c = moneyToCents(price);
  const sub = offer.billing_type === 'subscription';
  return (
    <Card className="max-w-xl space-y-5">
      <div><Field label="Preço" inputMode="numeric" value={price} onChange={e => setPrice(maskMoney(e.target.value))} mono right={<span className="text-ink-mute">R$</span>} hint={sub ? 'Novo preço vale só para novos assinantes.' : undefined} />
        <p className="mt-2 text-[14px] text-ok">A cada venda você recebe <b className="num">{brl(c >= 500 ? netCents(c) : 0)}</b></p></div>
      <fieldset><legend className="mb-2 font-semibold">Formas de pagamento</legend>
        {[['pix', 'Pix'], ['card', 'Cartão de crédito'], ['boleto', 'Boleto']].map(([k, l]) => <Toggle key={k} label={l} checked={methods.includes(k)} onChange={v => setMethods(v ? [...methods, k] : methods.filter(x => x !== k))} />)}
      </fieldset>
      {!sub && methods.includes('card') && <>
        <Select label="Máximo de parcelas" value={max} onChange={e => setMax(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}x</option>)}</Select>
        <Select label="Juros do parcelamento" value={mode} onChange={e => setMode(e.target.value)}><option value="buyer">Cliente paga os juros (2,99% a.m.)</option><option value="producer">Eu absorvo os juros (parcelado sem juros)</option></Select>
      </>}
      {methods.includes('pix') && <Field label="Validade do Pix (minutos)" type="number" min={10} max={1440} value={pixMin} onChange={e => setPixMin(Number(e.target.value))} />}
      {methods.includes('boleto') && <Field label="Vencimento do boleto (dias)" type="number" min={1} max={7} value={boletoDays} onChange={e => setBoletoDays(Number(e.target.value))} />}
      <Button onClick={() => save(`/v1/offers/${offer.id}`, { price_cents: c, max_installments: max, installment_interest: mode, methods, pix_expiration_min: pixMin, boleto_due_days: boletoDays })}>Salvar</Button>
    </Card>
  );
}

function Garantia({ p, offer, save }: any) {
  const [g, setG] = useState(p.guarantee_days);
  const [limit, setLimit] = useState(offer.sales_limit ?? '');
  const [ends, setEnds] = useState(offer.ends_at ? offer.ends_at.slice(0, 10) : '');
  return (
    <Card className="max-w-xl space-y-5">
      <fieldset><legend className="mb-2 font-semibold">Garantia</legend><div className="flex flex-wrap gap-2">{[7, 15, 30].map(d => <button key={d} onClick={() => setG(d)} className={cx('min-h-[44px] rounded-ctl border-2 px-4 font-bold', g === d ? 'border-action bg-action-soft/40' : 'border-line')}>{d} dias</button>)}</div>
        <p className="mt-2 text-[13.5px] text-ink-mute">O mínimo é 7 dias (direito de arrependimento — CDC, art. 49). Dentro da garantia, o cliente pede reembolso sozinho.</p></fieldset>
      <Field label="Limite de vendas (opcional)" type="number" min={1} value={limit} onChange={e => setLimit(e.target.value)} hint="Deixe em branco para vender sem limite." />
      <Field label="Encerrar a oferta em (opcional)" type="date" value={ends} onChange={e => setEnds(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={async () => { await save(`/v1/products/${p.id}`, { guarantee_days: g }); await save(`/v1/offers/${offer.id}`, { sales_limit: limit ? Number(limit) : null, ends_at: ends ? new Date(ends + 'T23:59:59-03:00').toISOString() : null }); }}>Salvar</Button>
        {offer.status === 'active' ? <Button variant="secondary" onClick={() => save(`/v1/offers/${offer.id}`, { status: 'paused' })}>Pausar vendas</Button> : offer.status === 'paused' ? <Button variant="secondary" onClick={() => save(`/v1/offers/${offer.id}`, { status: 'active' })}>Retomar vendas</Button> : null}
      </div>
    </Card>
  );
}

function Especial({ p, offer, save }: any) {
  const [items, setItems] = useState<{ offer_id: string; headline: string }[]>(offer.bumps.map((b: any) => ({ offer_id: b.bump_offer_id, headline: b.headline ?? '' })));
  return (
    <Card className="max-w-xl space-y-4">
      <p className="text-ink-soft">Até 3 produtos seus que o cliente pode incluir com um clique na página de pagamento.</p>
      {p.bump_candidates.length === 0 && <Banner tone="info">Crie outro produto para oferecê-lo aqui.</Banner>}
      {items.map((it, i) => (
        <div key={i} className="rounded-ctl border border-line p-3">
          <Select label={`Oferta especial ${i + 1}`} value={it.offer_id} onChange={e => setItems(items.map((x, k) => k === i ? { ...x, offer_id: e.target.value } : x))}>{p.bump_candidates.map((c: any) => <option key={c.offer_id} value={c.offer_id}>{c.name} — {brl(c.price_cents)}</option>)}</Select>
          <Field className="mt-2" label="Frase (opcional)" value={it.headline} onChange={e => setItems(items.map((x, k) => k === i ? { ...x, headline: e.target.value } : x))} maxLength={140} />
          <Button size="sm" variant="ghost" className="mt-1 text-bad" onClick={() => setItems(items.filter((_, k) => k !== i))}>Remover</Button>
        </div>
      ))}
      {items.length < 3 && p.bump_candidates.length > 0 && <Button variant="secondary" onClick={() => setItems([...items, { offer_id: p.bump_candidates[0].offer_id, headline: '' }])}>+ Adicionar oferta especial</Button>}
      <div><Button onClick={() => save(`/v1/offers/${offer.id}/bumps`, { items }, 'PUT')}>Salvar</Button></div>
    </Card>
  );
}

function Upsell({ p, offer, save }: any) {
  const cands = (p.funnel_candidates ?? []).filter((c: any) => c.offer_id !== offer.id);
  const [f, setF] = useState({
    upsell_offer_id: offer.upsell_offer_id ?? '', upsell_headline: offer.upsell_headline ?? '', upsell_text: offer.upsell_text ?? '',
    downsell_offer_id: offer.downsell_offer_id ?? '', downsell_headline: offer.downsell_headline ?? '', downsell_text: offer.downsell_text ?? '',
  });
  const label = (c: any) => `${c.name}${c.offer_name && c.offer_name !== 'Padrão' ? ` (${c.offer_name})` : ''} — ${brl(c.price_cents)}`;
  const up = cands.find((c: any) => c.offer_id === f.upsell_offer_id);
  const down = cands.find((c: any) => c.offer_id === f.downsell_offer_id);
  const nul = (v: string) => v.trim() || null;
  return (
    <Card className="max-w-xl space-y-5">
      <div>
        <p className="text-ink-soft">Depois que o pagamento é aprovado, a página de obrigado mostra mais uma oferta. O cliente compra com <b>1 clique</b>: no cartão, cobramos o mesmo cartão da compra; no Pix, geramos um Pix novo.</p>
        <p className="mt-2 text-[13.5px] text-ink-mute">A oferta fica disponível por 30 minutos depois do pagamento. Cada compra adicional é um pedido separado, com garantia e reembolso próprios.</p>
      </div>
      {offer.billing_type === 'subscription' && <Banner tone="info">Esta é uma assinatura: o upsell aparece depois do pagamento da primeira cobrança.</Banner>}
      {cands.length === 0 && <Banner tone="info">Crie outro produto (ou outra oferta) de pagamento único para oferecer aqui.</Banner>}
      {cands.length > 0 && <>
        <fieldset className="space-y-3">
          <legend className="mb-1 font-semibold">Upsell</legend>
          <Select label="Oferta mostrada depois da compra" value={f.upsell_offer_id} onChange={e => setF({ ...f, upsell_offer_id: e.target.value, ...(e.target.value ? {} : { downsell_offer_id: '' }) })}>
            <option value="">Nenhuma (sem upsell)</option>
            {cands.map((c: any) => <option key={c.offer_id} value={c.offer_id}>{label(c)}</option>)}
          </Select>
          {f.upsell_offer_id && <>
            <Field label="Título" value={f.upsell_headline} onChange={e => setF({ ...f, upsell_headline: e.target.value })} maxLength={120} hint={`Em branco: “Leve também ${up?.name ?? 'o produto'}”.`} />
            <Textarea label="Texto (opcional)" value={f.upsell_text} onChange={e => setF({ ...f, upsell_text: e.target.value })} maxLength={600} hint="Em branco, usamos a descrição do produto." />
          </>}
        </fieldset>
        {f.upsell_offer_id && <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="mb-1 font-semibold">Downsell (opcional)</legend>
          <p className="text-[14px] text-ink-mute">Aparece só se o cliente disser “Não, obrigado” ao upsell (ou se o cartão não passar). Normalmente é uma versão mais barata.</p>
          <Select label="Oferta se o cliente recusar" value={f.downsell_offer_id} onChange={e => setF({ ...f, downsell_offer_id: e.target.value })}>
            <option value="">Nenhuma</option>
            {cands.filter((c: any) => c.offer_id !== f.upsell_offer_id).map((c: any) => <option key={c.offer_id} value={c.offer_id}>{label(c)}</option>)}
          </Select>
          {f.downsell_offer_id && <>
            <Field label="Título" value={f.downsell_headline} onChange={e => setF({ ...f, downsell_headline: e.target.value })} maxLength={120} hint={`Em branco: “Leve também ${down?.name ?? 'o produto'}”.`} />
            <Textarea label="Texto (opcional)" value={f.downsell_text} onChange={e => setF({ ...f, downsell_text: e.target.value })} maxLength={600} />
          </>}
          {up && down && BigInt(down.price_cents) >= BigInt(up.price_cents) && <Banner tone="warn">O downsell costuma ser mais barato que o upsell.</Banner>}
        </fieldset>}
        <div><Button onClick={() => save(`/v1/offers/${offer.id}/funnel`, {
          upsell_offer_id: f.upsell_offer_id || null, upsell_headline: nul(f.upsell_headline), upsell_text: nul(f.upsell_text),
          downsell_offer_id: f.downsell_offer_id || null, downsell_headline: nul(f.downsell_headline), downsell_text: nul(f.downsell_text),
        }, 'PUT')}>Salvar</Button></div>
      </>}
    </Card>
  );
}

function Cupons({ p, offer, reload, setMsg }: any) {
  const [c, setC] = useState({ code: '', kind: 'percent', value: '', ends_at: '', max_uses: '' });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="font-extrabold">Novo cupom</h2>
        <Field label="Código" value={c.code} onChange={e => setC({ ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} mono maxLength={20} />
        <div className="grid grid-cols-2 gap-3"><Select label="Tipo" value={c.kind} onChange={e => setC({ ...c, kind: e.target.value })}><option value="percent">% de desconto</option><option value="fixed">R$ de desconto</option></Select>
          <Field label={c.kind === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} inputMode="numeric" value={c.value} onChange={e => setC({ ...c, value: c.kind === 'fixed' ? maskMoney(e.target.value) : e.target.value.replace(/\D/g, '').slice(0, 2) })} mono /></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Válido até" type="date" value={c.ends_at} onChange={e => setC({ ...c, ends_at: e.target.value })} /><Field label="Limite de usos" type="number" value={c.max_uses} onChange={e => setC({ ...c, max_uses: e.target.value })} /></div>
        <Button onClick={async () => { try { await post('/v1/coupons', { code: c.code, kind: c.kind, value: c.kind === 'percent' ? Number(c.value) * 100 : moneyToCents(c.value), offer_ids: [offer.id], ends_at: c.ends_at ? new Date(c.ends_at + 'T23:59:59-03:00').toISOString() : null, max_uses: c.max_uses ? Number(c.max_uses) : null }); setC({ code: '', kind: 'percent', value: '', ends_at: '', max_uses: '' }); setMsg({ tone: 'ok', text: 'Cupom criado.' }); reload(); } catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); } }}>Criar cupom</Button>
      </Card>
      <Card><h2 className="font-extrabold">Cupons</h2>
        {p.coupons.length === 0 ? <p className="mt-2 text-ink-mute">Nenhum cupom ainda.</p> : <ul className="mt-2 divide-y divide-line">{p.coupons.map((k: any) => (
          <li key={k.id} className="flex min-h-[52px] items-center justify-between gap-2"><span><span className="num font-bold">{k.code}</span> <span className="text-ink-mute">· {k.kind === 'percent' ? pct(k.value) : brl(k.value)} · {k.uses} usos</span>{!k.active && <Pill>Desativado</Pill>}</span>
            {k.active && <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await api('DELETE', `/v1/coupons/${k.id}`); reload(); }}>Desativar</Button>}</li>))}</ul>}
        <p className="mt-3 text-[13px] text-ink-mute">Dica: o cupom também funciona no link, ex.: <span className="num">{offer.checkout_url}?cupom=CODIGO</span></p>
      </Card>
    </div>
  );
}

function Visual({ p, offer, save, reload }: any) {
  const th = offer.theme ?? {};
  const [v, setV] = useState({ color: th.color ?? '#5B3FE6', logo_url: th.logo_url ?? '', banner_url: th.banner_url ?? '', countdown_minutes: th.countdown_minutes ?? 0, testimonials: th.testimonials ?? [] });
  const [desc, setDesc] = useState(p.description ?? '');
  return (
    <Card className="max-w-xl space-y-4">
      <div><p className="mb-1.5 font-semibold">Capa do produto</p>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-ctl border border-line px-4 font-bold text-action"><input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) { await uploadFile(f, p.id, { purpose: 'cover' }); reload(); } }} />{p.cover_url ? 'Trocar capa' : 'Enviar capa'}</label>
        {p.cover_url && <img src={p.cover_url} alt="" className="mt-2 h-20 w-20 rounded-ctl object-cover" />}</div>
      <div className="flex items-end gap-3"><Field label="Cor principal" value={v.color} onChange={e => setV({ ...v, color: e.target.value })} mono className="flex-1" /><input type="color" aria-label="Escolher cor" value={v.color} onChange={e => setV({ ...v, color: e.target.value })} className="h-11 w-14 rounded-ctl border border-line" /></div>
      <Field label="Logo (URL da imagem)" value={v.logo_url} onChange={e => setV({ ...v, logo_url: e.target.value })} placeholder="https://…" />
      <Field label="Banner (URL da imagem)" value={v.banner_url} onChange={e => setV({ ...v, banner_url: e.target.value })} placeholder="https://…" />
      <Field label="Cronômetro de escassez (minutos, 0 = desligado)" type="number" min={0} max={1440} value={v.countdown_minutes} onChange={e => setV({ ...v, countdown_minutes: Number(e.target.value) })} />
      <Textarea label="Descrição do produto" value={desc} onChange={e => setDesc(e.target.value)} />
      <div><p className="mb-1.5 font-semibold">Depoimentos</p>
        {v.testimonials.map((t: any, i: number) => <div key={i} className="mb-2 grid gap-2 rounded-ctl border border-line p-3"><Field label="Nome" value={t.name} onChange={e => setV({ ...v, testimonials: v.testimonials.map((x: any, k: number) => k === i ? { ...x, name: e.target.value } : x) })} /><Textarea label="Depoimento" value={t.text} onChange={e => setV({ ...v, testimonials: v.testimonials.map((x: any, k: number) => k === i ? { ...x, text: e.target.value } : x) })} /></div>)}
        {v.testimonials.length < 6 && <Button size="sm" variant="secondary" onClick={() => setV({ ...v, testimonials: [...v.testimonials, { name: '', text: '' }] })}>+ Depoimento</Button>}</div>
      <Button onClick={async () => { await save(`/v1/products/${p.id}`, { description: desc || null }); await save(`/v1/offers/${offer.id}`, { theme: { ...v, testimonials: v.testimonials.filter((t: any) => t.name && t.text) } }); }}>Salvar</Button>
    </Card>
  );
}

function Pixels({ offer, save }: any) {
  const px = offer.theme?.pixels ?? {};
  const [v, setV] = useState({ meta_pixel_id: px.meta_pixel_id ?? '', meta_capi_token: px.meta_capi_token ?? '', ga4_id: px.ga4_id ?? '', google_ads_id: px.google_ads_id ?? '', tiktok_pixel_id: px.tiktok_pixel_id ?? '' });
  return (
    <Card className="max-w-xl space-y-4">
      <p className="text-ink-soft">Eventos enviados: InitiateCheckout, AddPaymentInfo e Purchase. A compra também vai pela Conversions API no servidor, com o mesmo identificador (sem duplicar).</p>
      <Field label="Pixel Meta (ID)" value={v.meta_pixel_id} onChange={e => setV({ ...v, meta_pixel_id: e.target.value })} mono />
      <Field label="Token da Conversions API (Meta)" type="password" value={v.meta_capi_token} onChange={e => setV({ ...v, meta_capi_token: e.target.value })} mono />
      <Field label="Google Analytics 4 (G-XXXX)" value={v.ga4_id} onChange={e => setV({ ...v, ga4_id: e.target.value })} mono />
      <Field label="Google Ads (AW-XXXX)" value={v.google_ads_id} onChange={e => setV({ ...v, google_ads_id: e.target.value })} mono />
      <Field label="TikTok Pixel" value={v.tiktok_pixel_id} onChange={e => setV({ ...v, tiktok_pixel_id: e.target.value })} mono />
      <Button onClick={() => save(`/v1/offers/${offer.id}`, { theme: { pixels: v } })}>Salvar</Button>
    </Card>
  );
}

function Obrigado({ offer, save }: any) {
  const [url, setUrl] = useState(offer.thank_you_url ?? '');
  return (
    <Card className="max-w-xl space-y-4">
      <p className="text-ink-soft">Por padrão, o cliente vê a nossa página de obrigado com o botão de acesso. Se preferir, envie para a sua página (recebe <span className="num">order_id</span> e <span className="num">status</span>).</p>
      <Field label="URL externa (https)" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://seusite.com/obrigado" />
      <Button onClick={() => save(`/v1/offers/${offer.id}`, { thank_you_url: url || null })}>Salvar</Button>
    </Card>
  );
}

function Afiliados({ p, save, reload }: any) {
  const [v, setV] = useState({ affiliation_enabled: p.affiliation_enabled, affiliation_auto_approve: p.affiliation_auto_approve, affiliate_commission_bps: p.affiliate_commission_bps / 100, affiliate_cookie_days: p.affiliate_cookie_days, affiliate_attribution: p.affiliate_attribution, marketplace_listed: p.marketplace_listed, category: p.category ?? '', affiliate_rules: p.affiliate_rules ?? '' });
  const [offerBps, setOfferBps] = useState<Record<string, string>>(Object.fromEntries(p.offers.map((o: any) => [o.id, o.affiliate_commission_bps != null ? String(o.affiliate_commission_bps / 100) : ''])));
  const [m, setM] = useState({ kind: 'link', title: '', url: '', body: '' });
  const [mErr, setMErr] = useState<string | null>(null);
  const invite = typeof window !== 'undefined' ? `${location.origin}/afiliar/${p.id}` : '';
  const pending = p.affiliations.filter((a: any) => a.status === 'pending');
  const Row = ({ a }: any) => (
    <li className="py-3"><div className="flex min-h-[44px] items-center justify-between gap-2"><span className="min-w-0"><span className="block truncate font-semibold">{a.name}</span><span className="num text-[13px] text-ink-mute">{a.email} · {a.code}{a.source === 'marketplace' ? ' · pela vitrine' : ''}</span></span>
      <span className="flex flex-none items-center gap-2">{a.status === 'active' ? <Pill tone="ok">Ativo</Pill> : a.status === 'pending' ? <Pill tone="warn">Pendente</Pill> : <Pill tone="bad">Bloqueado</Pill>}
        {a.status !== 'active' && <Button size="sm" variant="secondary" onClick={async () => { await post(`/v1/affiliations/${a.id}/approve`); reload(); }}>Aprovar</Button>}
        {a.status !== 'blocked' && <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await post(`/v1/affiliations/${a.id}/block`); reload(); }}>{a.status === 'pending' ? 'Recusar' : 'Bloquear'}</Button>}</span></div>
      {a.message && <p className="mt-1 rounded-ctl bg-canvas px-3 py-2 text-[14px] text-ink-soft">“{a.message}”</p>}</li>);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card className="space-y-3">
          <Toggle label="Aceitar afiliados neste produto" checked={v.affiliation_enabled} onChange={x => setV({ ...v, affiliation_enabled: x, marketplace_listed: x ? v.marketplace_listed : false })} />
          {v.affiliation_enabled && <>
            <Toggle label="Aprovar afiliados automaticamente" checked={v.affiliation_auto_approve} onChange={x => setV({ ...v, affiliation_auto_approve: x })} />
            <Field label="Comissão (%)" type="number" min={1} max={90} value={v.affiliate_commission_bps} onChange={e => setV({ ...v, affiliate_commission_bps: Number(e.target.value) })} hint="Calculada sobre o valor da venda depois da taxa. Venda por afiliado tem taxa de 6,49% + R$ 1,49." />
            <Field label="Duração do cookie (dias)" type="number" min={1} max={365} value={v.affiliate_cookie_days} onChange={e => setV({ ...v, affiliate_cookie_days: Number(e.target.value) })} />
            <Select label="Quem leva a comissão" value={v.affiliate_attribution} onChange={e => setV({ ...v, affiliate_attribution: e.target.value })}><option value="last_click">Último clique</option><option value="first_click">Primeiro clique</option></Select>
            <div className="border-t border-line pt-3"><p className="font-extrabold">Marketplace de afiliados</p>
              {p.marketplace_delisted_at ? <Banner tone="bad" className="mt-2">Este produto foi retirado da vitrine: {p.marketplace_delisted_reason}. Fale com o suporte.</Banner> : <>
                <Toggle label="Mostrar na vitrine para todos os afiliados" hint="Afiliados da Domma Mart encontram o produto e pedem afiliação. Sem isso, só entra quem tem o seu link de convite." checked={v.marketplace_listed} onChange={x => setV({ ...v, marketplace_listed: x })} />
                {p.moderation_status !== 'approved' && v.marketplace_listed && <p className="text-[13.5px] text-warn">O produto aparece na vitrine quando estiver aprovado e à venda.</p>}
              </>}
              <Select label="Categoria" value={v.category} onChange={e => setV({ ...v, category: e.target.value })} className="mt-2"><option value="">Escolha…</option>{Object.entries(p.categories ?? {}).map(([k, l]) => <option key={k} value={k}>{l as string}</option>)}</Select>
              <Textarea className="mt-2" label="Regras de divulgação (opcional)" value={v.affiliate_rules} onChange={e => setV({ ...v, affiliate_rules: e.target.value.slice(0, 2000) })} hint="O afiliado aceita antes de se afiliar. Ex.: proibido usar a marca em anúncios de busca; não prometer resultados." />
            </div>
            <div><p className="mb-1 text-[14px] font-semibold">Link de convite para afiliados</p><div className="flex gap-2"><p className="num flex-1 truncate rounded-ctl bg-canvas px-3 py-2.5 text-[13px]">{invite}</p><CopyButton text={invite} size="sm" /></div></div>
          </>}
          <Button onClick={() => save(`/v1/products/${p.id}`, { ...v, category: v.category || null, affiliate_rules: v.affiliate_rules.trim() || null, affiliate_commission_bps: Math.round(v.affiliate_commission_bps * 100) })}>Salvar</Button>
        </Card>
        {v.affiliation_enabled && p.offers.length > 0 && <Card className="space-y-3"><h2 className="font-extrabold">Comissão por oferta</h2>
          <p className="text-[14px] text-ink-mute">Em branco, vale a comissão do produto ({v.affiliate_commission_bps}%). Útil para pagar mais no plano anual ou menos numa oferta de entrada.</p>
          {p.offers.map((o: any) => <div key={o.id} className="flex items-end gap-2"><Field className="flex-1" label={`${o.name} — ${brl(o.price_cents)}`} inputMode="decimal" placeholder={String(v.affiliate_commission_bps)} value={offerBps[o.id]} onChange={e => setOfferBps({ ...offerBps, [o.id]: e.target.value.replace(/[^\d,.]/g, '') })} right={<span className="text-ink-mute">%</span>} />
            <Button variant="secondary" onClick={() => { const x = offerBps[o.id]; save(`/v1/offers/${o.id}`, { affiliate_commission_bps: x ? Math.round(Number(x.replace(',', '.')) * 100) : null }); }}>Salvar</Button></div>)}
        </Card>}
      </div>
      <div className="space-y-4">
        {pending.length > 0 && <Card className="border-warn-line"><h2 className="font-extrabold">Pedidos de afiliação ({pending.length})</h2><ul className="mt-1 divide-y divide-line">{pending.map((a: any) => <Row key={a.id} a={a} />)}</ul></Card>}
        <Card><h2 className="font-extrabold">Afiliados</h2>
          {p.affiliations.filter((a: any) => a.status !== 'pending').length === 0 ? <p className="mt-2 text-ink-mute">Ninguém se afiliou ainda.</p> : <ul className="mt-1 divide-y divide-line">{p.affiliations.filter((a: any) => a.status !== 'pending').map((a: any) => <Row key={a.id} a={a} />)}</ul>}
        </Card>
        {v.affiliation_enabled && <Card className="space-y-3"><h2 className="font-extrabold">Materiais para afiliados</h2>
          <p className="text-[14px] text-ink-mute">Afiliados aprovados veem estes materiais: links para pastas de criativos e vídeos, e textos prontos (anúncios, e-mails, roteiros).</p>
          {p.materials?.length > 0 && <ul className="divide-y divide-line">{p.materials.map((x: any) => <li key={x.id} className="flex min-h-[44px] items-center justify-between gap-2"><span className="min-w-0 truncate"><Pill>{x.kind === 'link' ? 'Link' : 'Texto'}</Pill> {x.title}</span><Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await api('DELETE', `/v1/materials/${x.id}`); reload(); }}>Remover</Button></li>)}</ul>}
          {mErr && <Banner tone="bad">{mErr}</Banner>}
          <div className="grid grid-cols-[140px_1fr] gap-2"><Select label="Tipo" value={m.kind} onChange={e => setM({ ...m, kind: e.target.value })}><option value="link">Link</option><option value="text">Texto</option></Select><Field label="Título" value={m.title} onChange={e => setM({ ...m, title: e.target.value })} placeholder="Ex.: Criativos para Instagram" /></div>
          {m.kind === 'link' ? <Field label="Link (https://)" value={m.url} onChange={e => setM({ ...m, url: e.target.value })} placeholder="https://drive.google.com/…" /> : <Textarea label="Texto" value={m.body} onChange={e => setM({ ...m, body: e.target.value })} />}
          <Button variant="secondary" onClick={async () => { setMErr(null); try { await post(`/v1/products/${p.id}/materials`, { kind: m.kind, title: m.title, url: m.kind === 'link' ? m.url : undefined, body: m.kind === 'text' ? m.body : undefined }); setM({ kind: m.kind, title: '', url: '', body: '' }); reload(); } catch (e) { setMErr(Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title); } }}>+ Adicionar material</Button>
        </Card>}
      </div>
    </div>
  );
}

function Socios({ p, reload, setMsg }: any) {
  const [email, setEmail] = useState(''); const [share, setShare] = useState('');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="font-extrabold">Convidar sócio</h2>
        <p className="text-[14px] text-ink-soft">O sócio recebe uma % do que sobra para você em cada venda, direto no saldo dele. Ele precisa confirmar a identidade para aceitar.</p>
        <Field label="E-mail do sócio" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <Field label="Percentual sobre o seu líquido (%)" type="number" min={1} max={90} value={share} onChange={e => setShare(e.target.value)} />
        <Button onClick={async () => { try { await post(`/v1/products/${p.id}/coproductions`, { email, share_bps: Math.round(Number(share) * 100) }); setEmail(''); setShare(''); setMsg({ tone: 'ok', text: 'Convite enviado por e-mail.' }); reload(); } catch (e) { setMsg({ tone: 'bad', text: Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title }); } }}>Enviar convite</Button>
      </Card>
      <Card><h2 className="font-extrabold">Sócios</h2>
        {p.coproductions.length === 0 ? <p className="mt-2 text-ink-mute">Nenhum sócio.</p> : <ul className="mt-2 divide-y divide-line">{p.coproductions.map((c: any) => (
          <li key={c.id} className="flex min-h-[52px] items-center justify-between gap-2"><span>{c.invited_email} · <b>{pct(c.share_bps)}</b></span><span className="flex items-center gap-2">{c.status === 'active' ? <Pill tone="ok">Ativo</Pill> : c.status === 'invited' ? <Pill tone="warn">Convite enviado</Pill> : <Pill>Encerrado</Pill>}{c.status !== 'ended' && <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { await api('DELETE', `/v1/coproductions/${c.id}`); reload(); }}>Encerrar</Button>}</span></li>))}</ul>}
      </Card>
    </div>
  );
}
