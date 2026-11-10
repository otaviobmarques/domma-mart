'use client';
import { post, api } from './api';
/** Upload direto em partes por URL pré-assinada; retoma de onde parou (19.8). */
export async function uploadFile(file: File, productId: string, opts: { purpose?: 'content' | 'cover' | 'attachment'; lessonId?: string; moduleId?: string; onProgress?: (pct: number) => void } = {}) {
  const start = await post<any>('/v1/uploads', { product_id: productId, filename: file.name, size: file.size, mime: file.type || 'application/octet-stream', purpose: opts.purpose ?? 'content', lesson_id: opts.lessonId });
  let sent = 0;
  for (const part of start.parts) {
    const from = (part.n - 1) * start.part_size;
    const blob = file.slice(from, Math.min(file.size, from + start.part_size));
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(part.url, { method: 'PUT', body: blob, headers: { 'content-type': 'application/octet-stream' } });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.title || 'Falha no envio'), { fatal: r.status === 422 || r.status === 413 }); }
        break;
      } catch (e: any) {
        if (e.fatal || attempt >= 4) throw e;
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    sent += blob.size;
    opts.onProgress?.(Math.round((sent / file.size) * 100));
  }
  return api<any>('POST', `/v1/uploads/${start.upload_id}/complete`, { purpose: opts.purpose ?? 'content', lesson_id: opts.lessonId, module_id: opts.moduleId });
}
