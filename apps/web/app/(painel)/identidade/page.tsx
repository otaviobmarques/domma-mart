'use client';
import { useEffect, useRef, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { maskDoc, digits, isValidCPF, isValidCNPJ } from '@/lib/format';
import { useMe } from '@/components/session';
import { Button, Card, Field, Banner, Skeleton, cx } from '@/components/ui';

/** Confirmar identidade (19.12 b): PF/PJ → dados → documento e selfie → chave Pix. */
async function toDataUrl(file: File, max = 1600): Promise<string> {
  const img = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export default function Identidade() {
  const { reload } = useMe();
  const [status, setStatus] = useState<any>(null);
  const [step, setStep] = useState(1);
  const [type, setType] = useState<'pf' | 'pj'>('pf');
  const [d, setD] = useState({ name: '', document: '', birth_date: '', partner_name: '', partner_document: '' });
  const [imgs, setImgs] = useState<{ doc_front?: string; doc_back?: string; selfie?: string }>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { get('/v1/identity').then(setStatus); }, []);

  async function openCam() {
    setCam(true);
    try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); if (video.current) { video.current.srcObject = s; await video.current.play(); } }
    catch { setCam(false); setErr('Não conseguimos abrir a câmera. Envie uma foto da galeria.'); }
  }
  function snap() {
    const v = video.current!; const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0); setImgs({ ...imgs, selfie: c.toDataURL('image/jpeg', 0.85) });
    (v.srcObject as MediaStream)?.getTracks().forEach(t => t.stop()); setCam(false);
  }
  function next2() {
    const e: Record<string, string> = {};
    if (d.name.trim().length < 3) e.name = type === 'pf' ? 'Digite seu nome completo.' : 'Digite a razão social.';
    if (type === 'pf' ? !isValidCPF(d.document) : !isValidCNPJ(d.document)) e.document = type === 'pf' ? 'CPF inválido. Confira os números.' : 'CNPJ inválido. Confira os números.';
    if (type === 'pf' && !d.birth_date) e.birth_date = 'Informe sua data de nascimento.';
    if (type === 'pj' && d.partner_name.trim().length < 3) e.partner_name = 'Informe o nome do sócio responsável.';
    if (type === 'pj' && !isValidCPF(d.partner_document)) e.partner_document = 'CPF do sócio inválido.';
    setErrors(e); if (!Object.keys(e).length) setStep(3);
  }
  async function submit() {
    setBusy(true); setErr(null);
    try { await post('/v1/identity', { person_type: type, ...d, document: digits(d.document), partner_document: d.partner_document ? digits(d.partner_document) : undefined, birth_date: d.birth_date || undefined, partner_name: d.partner_name || undefined, ...imgs }); setStep(4); reload(); setStatus(await get('/v1/identity')); }
    catch (e) { const x = e as ApiError; setErr(Object.values(x.fields ?? {})[0] ?? x.title); }
    setBusy(false);
  }

  if (!status) return <Skeleton className="h-64 w-full" />;
  if (status.status === 'approved') return <Card className="max-w-xl"><p className="text-[20px] font-extrabold text-ok">✓ Identidade confirmada</p><p className="mt-1 text-ink-soft">Você já pode sacar.</p></Card>;
  if (status.status === 'in_review' && step !== 4) return <Card className="max-w-xl"><p className="text-[20px] font-extrabold">Em análise — avisamos em até 1 dia útil</p><p className="mt-1 text-ink-soft">Enquanto isso, você já pode vender. O saque fica liberado depois da confirmação.</p></Card>;
  const Img = ({ k, label }: { k: 'doc_front' | 'doc_back'; label: string }) => (
    <label className={cx('flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed p-3 text-center', imgs[k] ? 'border-ok bg-ok-soft/40' : 'border-line bg-white hover:border-action/50')}>
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) setImgs({ ...imgs, [k]: await toDataUrl(f) }); }} />
      {imgs[k] ? <img src={imgs[k]} alt="" className="max-h-28 rounded" /> : <><span className="font-bold">{label}</span><span className="text-[13px] text-ink-mute">Tirar foto ou escolher</span></>}
    </label>
  );
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-[26px] font-extrabold">Confirmar sua identidade</h1>
      <p className="mt-1 text-ink-soft">Leva uns 3 minutos. Isso protege você e seus clientes.</p>
      {status.last?.decision_reason && status.status !== 'in_review' && <Banner tone="warn" className="mt-4">Da última vez: {status.last.decision_reason}</Banner>}
      <ol className="mt-4 flex gap-1.5 text-[12.5px] font-bold">{['Tipo', 'Dados', 'Documentos', 'Pronto'].map((s, i) => <li key={s} className={cx('rounded-full px-2.5 py-0.5', step > i ? 'bg-action text-white' : 'bg-white text-ink-mute ring-1 ring-line')}>{i + 1}. {s}</li>)}</ol>
      <Card className="mt-4 space-y-4">
        {step === 1 && <>
          <p className="font-bold">Você vende como pessoa física ou empresa?</p>
          <div className="grid grid-cols-2 gap-2">{([['pf', 'Pessoa física', 'Com seu CPF'], ['pj', 'Empresa', 'Com CNPJ']] as const).map(([v, t, s]) => <button key={v} onClick={() => setType(v)} className={cx('rounded-ctl border-2 p-4 text-left', type === v ? 'border-action bg-action-soft/40' : 'border-line')}><span className="block font-bold">{t}</span><span className="text-[13.5px] text-ink-mute">{s}</span></button>)}</div>
          <Button full onClick={() => setStep(2)}>Continuar</Button>
        </>}
        {step === 2 && <>
          <Field label={type === 'pf' ? 'Nome completo' : 'Razão social'} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} error={errors.name} />
          <Field label={type === 'pf' ? 'CPF' : 'CNPJ'} inputMode="numeric" value={d.document} onChange={e => setD({ ...d, document: maskDoc(e.target.value) })} error={errors.document} />
          {type === 'pf' ? <Field label="Data de nascimento" type="date" value={d.birth_date} onChange={e => setD({ ...d, birth_date: e.target.value })} error={errors.birth_date} />
            : <><Field label="Nome do sócio responsável" value={d.partner_name} onChange={e => setD({ ...d, partner_name: e.target.value })} error={errors.partner_name} /><Field label="CPF do sócio" inputMode="numeric" value={d.partner_document} onChange={e => setD({ ...d, partner_document: maskDoc(e.target.value) })} error={errors.partner_document} /></>}
          <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(1)}>Voltar</Button><Button onClick={next2}>Continuar</Button></div>
        </>}
        {step === 3 && <>
          <p className="font-bold">Foto do documento (RG ou CNH)</p>
          <div className="grid grid-cols-2 gap-3"><Img k="doc_front" label="Frente" /><Img k="doc_back" label="Verso" /></div>
          <p className="font-bold">Selfie</p>
          {cam ? <div className="space-y-2"><video ref={video} playsInline muted className="w-full rounded-card bg-black" /><Button full onClick={snap}>Tirar selfie</Button></div>
            : imgs.selfie ? <div className="flex items-center gap-3"><img src={imgs.selfie} alt="" className="h-24 w-24 rounded-ctl object-cover" /><Button variant="secondary" onClick={openCam}>Tirar de novo</Button></div>
            : <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={openCam}>Abrir câmera</Button><label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-ctl px-4 font-bold text-action"><input type="file" accept="image/*" capture="user" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) setImgs({ ...imgs, selfie: await toDataUrl(f) }); }} />Enviar foto</label></div>}
          <p className="text-[13px] text-ink-mute">Está no computador? Abra esta página no celular para usar a câmera: <span className="num">{typeof window !== 'undefined' ? location.href : ''}</span></p>
          {err && <Banner tone="bad">{err}</Banner>}
          <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(2)}>Voltar</Button><Button loading={busy} disabled={!imgs.doc_front || !imgs.selfie} onClick={submit}>Enviar para análise</Button></div>
        </>}
        {step === 4 && <>
          <p className="text-[20px] font-extrabold">Em análise — avisamos em até 1 dia útil</p>
          <p className="text-ink-soft">Último passo: cadastre a chave Pix no seu {type === 'pf' ? 'CPF' : 'CNPJ'} para receber os saques.</p>
          <a href="/financeiro"><Button full>Cadastrar chave Pix</Button></a>
        </>}
      </Card>
    </div>
  );
}
