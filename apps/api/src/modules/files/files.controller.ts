import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Response, Request } from 'express';
import { StorageService } from '../../infra/storage.service';
import { Public } from '../../http/context';
import { AppError } from '../../common/errors';

/** Entrega de arquivos por URL assinada e temporária, com suporte a Range (vídeo). */
@Controller('v1/files')
@Public()
export class FilesController {
  constructor(private storage: StorageService) {}

  @Get(':token')
  serve(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const p = this.storage.resolveSigned(token) as { k: string; nocache?: boolean; dl?: string } | null;
    if (!p) throw new AppError('AUTH_LINK_EXPIRED');
    if (!this.storage.exists(p.k)) throw new AppError('NOT_FOUND');
    const size = this.storage.size(p.k);
    const ext = p.k.split('.').pop()?.toLowerCase() ?? '';
    const types: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', zip: 'application/zip', epub: 'application/epub+zip' };
    res.set({
      'Content-Type': types[ext] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': p.k.startsWith('kyc/') || p.nocache ? 'no-store' : 'private, max-age=600',
      'Content-Disposition': p.dl ? `attachment; filename="${encodeURIComponent(p.dl)}"` : 'inline',
    });
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m?.[1] ? Number(m[1]) : 0;
      const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : Math.min(start + 4 * 1024 * 1024, size - 1);
      if (start >= size || start > end) { res.status(416).set('Content-Range', `bytes */${size}`).end(); return; }
      res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
      this.storage.stream(p.k, { start, end }).pipe(res);
      return;
    }
    res.set('Content-Length', String(size));
    this.storage.stream(p.k).pipe(res);
  }
}
