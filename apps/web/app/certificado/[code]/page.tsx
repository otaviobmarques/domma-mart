import { Logo } from '@/components/ui';
const API = process.env.API_URL || 'http://127.0.0.1:4000';

/** Verificação pública do certificado (RN-94). */
export default async function Certificado({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await fetch(`${API}/v1/members/certificates/${encodeURIComponent(code)}`, { cache: 'no-store', headers: process.env.EDGE_SECRET ? { 'x-domma-edge': process.env.EDGE_SECRET } : {} });
  const c = r.ok ? await r.json() : null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex justify-center"><Logo /></div>
      {!c ? <p className="text-center text-[18px] font-bold">Certificado não encontrado.</p> : (
        <div className="rounded-card border-8 border-double border-action/30 bg-white p-8 text-center shadow-card sm:p-14">
          <p className="text-[13px] font-extrabold uppercase tracking-[0.25em] text-action">Certificado de conclusão</p>
          <p className="mt-8 text-ink-mute">Certificamos que</p>
          <p className="mt-2 text-[30px] font-extrabold leading-tight">{c.student_name}</p>
          <p className="mt-4 text-ink-mute">concluiu o curso</p>
          <p className="mt-1 text-[22px] font-bold">{c.course_name}</p>
          <p className="mt-1 text-ink-mute">oferecido por {c.school}</p>
          <p className="mt-10 text-[14px] text-ink-mute">Emitido em {new Date(c.issued_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Código de verificação <span className="num font-bold text-ink">{c.code}</span></p>
          <p className="mt-1 text-[13px] text-ok">✓ Certificado válido, emitido pela Domma Mart.</p>
        </div>
      )}
    </main>
  );
}
