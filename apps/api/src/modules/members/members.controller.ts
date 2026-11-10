import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { Customer, Cust, CustomerCtx, Public } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { decrypt, base62 } from '../../common/crypto';
import { maskDocument } from '../../domain/validators';
import { toJSON } from '../../http/json';

const ACTIVE_WINDOW_MS = 2 * 60_000;
const MAX_SESSIONS = 2; // RN-90

@Controller('v1/members')
export class MembersController {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  private async enrollment(customerId: string, productId: string) {
    const e = await this.prisma.enrollments.findFirst({ where: { customer_id: customerId, product_id: productId, status: 'active', OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] }, orderBy: { created_at: 'asc' } });
    if (!e) throw new AppError('PERMISSION_DENIED', { code_detail: 'NO_ACCESS', title: 'Seu acesso a este curso terminou.' });
    return e;
  }

  private unlockAt(l: { drip_days: number | null; drip_date: Date | null }, enrolledAt: Date): Date | null {
    if (l.drip_date) return l.drip_date; // RN-93
    if (l.drip_days) return new Date(enrolledAt.getTime() + l.drip_days * 86400000);
    return null;
  }

  /** Vitrine estilo streaming (5.5). */
  @Get('courses') @Customer()
  async courses(@Cust() cu: CustomerCtx) {
    const ens = await this.prisma.enrollments.findMany({ where: { customer_id: cu.customerId, status: 'active' } });
    const products = await this.prisma.products.findMany({ where: { id: { in: ens.map(e => e.product_id) } }, include: { workspace: true } });
    const progress = await this.prisma.lesson_progress.groupBy({ by: ['product_id'], where: { customer_id: cu.customerId, completed_at: { not: null } }, _count: true });
    const totals = await this.prisma.lessons.groupBy({ by: ['product_id'], where: { product_id: { in: products.map(p => p.id) } }, _count: true });
    return toJSON(products.map(p => {
      const done = progress.find(x => x.product_id === p.id)?._count ?? 0;
      const total = totals.find(x => x.product_id === p.id)?._count ?? 0;
      return { id: p.id, name: p.name, type: p.type, cover_url: p.cover_url, school: p.workspace.name, service_url: p.service_url, progress_pct: total ? Math.round((done / total) * 100) : 0 };
    }));
  }

  @Get('products/:id') @Customer()
  async outline(@Cust() cu: CustomerCtx, @Param('id') id: string) {
    const e = await this.enrollment(cu.customerId, id);
    const p = await this.prisma.products.findUniqueOrThrow({ where: { id }, include: { workspace: true } });
    const modules = await this.prisma.course_modules.findMany({ where: { product_id: id }, include: { lessons: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } });
    const prog = await this.prisma.lesson_progress.findMany({ where: { customer_id: cu.customerId, product_id: id } });
    const files = p.type === 'file' ? await this.prisma.product_files.findMany({ where: { product_id: id } }) : [];
    const cert = await this.prisma.certificates.findUnique({ where: { customer_id_product_id: { customer_id: cu.customerId, product_id: id } } });
    const all = modules.flatMap(m => m.lessons);
    const done = prog.filter(x => x.completed_at).length;
    const now = new Date();
    return toJSON({
      product: { id: p.id, name: p.name, type: p.type, cover_url: p.cover_url, service_url: p.service_url, school: p.workspace.name },
      progress_pct: all.length ? Math.round((done / all.length) * 100) : 0,
      certificate_code: cert?.code ?? null,
      files: files.map(f => ({ id: f.id, filename: f.filename, size: f.size, url: this.storage.signedUrl(f.storage_key, 15 * 60, { dl: f.filename }) })),
      modules: modules.map((m, mi) => ({
        id: m.id, title: m.title, position: mi + 1,
        lessons: m.lessons.map((l, li) => {
          const ua = this.unlockAt(l, e.created_at);
          const locked = !!ua && ua > now;
          const pr = prog.find(x => x.lesson_id === l.id);
          return { id: l.id, title: l.title, kind: l.kind, position: li + 1, locked, unlock_in_days: locked ? Math.ceil((ua!.getTime() - now.getTime()) / 86400000) : 0, completed: !!pr?.completed_at, position_sec: pr?.position_sec ?? 0 };
        }),
      })),
    });
  }

  /** Abrir aula (19.6): valida matrícula e sessões; gera URL assinada (RN-90..92). */
  @Get('lessons/:id/playback') @Customer()
  async playback(@Cust() cu: CustomerCtx, @Param('id') id: string) {
    const l = await this.prisma.lessons.findUnique({ where: { id }, include: { module: true } });
    if (!l) throw new AppError('NOT_FOUND');
    const e = await this.enrollment(cu.customerId, l.product_id);
    const ua = this.unlockAt(l, e.created_at);
    if (ua && ua > new Date()) throw new AppError('PERMISSION_DENIED', { title: `Esta aula libera em ${Math.ceil((ua.getTime() - Date.now()) / 86400000)} dias.` });
    // limite de aparelhos simultâneos
    const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const others = await this.prisma.playback_sessions.count({ where: { customer_id: cu.customerId, product_id: l.product_id, customer_session_id: { not: cu.sessionId }, ended_at: null, last_seen_at: { gt: since } } });
    if (others >= MAX_SESSIONS) throw new AppError('PERMISSION_DENIED', { code_detail: 'DEVICE_LIMIT', title: 'Este curso já está aberto em 2 aparelhos. Feche em um deles para continuar.' });
    await this.prisma.playback_sessions.upsert({ where: { customer_session_id_product_id: { customer_session_id: cu.sessionId, product_id: l.product_id } }, create: { customer_id: cu.customerId, product_id: l.product_id, customer_session_id: cu.sessionId }, update: { last_seen_at: new Date(), ended_at: null } });
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: cu.customerId } });
    const pr = await this.prisma.lesson_progress.findUnique({ where: { customer_id_lesson_id: { customer_id: cu.customerId, lesson_id: id } } });
    const mods = await this.prisma.course_modules.findMany({ where: { product_id: l.product_id }, orderBy: { position: 'asc' }, include: { lessons: { orderBy: { position: 'asc' }, select: { id: true } } } });
    const flat = mods.flatMap(m => m.lessons.map(x => x.id));
    const idx = flat.indexOf(id);
    return toJSON({
      id: l.id, title: l.title, kind: l.kind, body: l.kind === 'text' || l.kind === 'link' ? l.body : null, status: l.status,
      module_position: mods.findIndex(m => m.id === l.module_id) + 1, lesson_position: l.position + 1, module_title: l.module.title,
      media_url: l.storage_key ? this.storage.signedUrl(l.storage_key, 2 * 3600, { nocache: true }) : null, // RN-91: 2 h
      media_expires_in: 2 * 3600,
      watermark: `${c.email} · ${maskDocument(decrypt(c.document_enc))}`, // RN-92
      attachments: ((l.attachments as any[]) ?? []).map(a => ({ name: a.name, url: this.storage.signedUrl(a.key, 15 * 60, { dl: a.name }) })),
      position_sec: pr?.position_sec ?? 0, completed: !!pr?.completed_at,
      prev_id: idx > 0 ? flat[idx - 1] : null, next_id: idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null,
    });
  }

  @Post('lessons/:id/progress') @Customer() @HttpCode(200)
  async progress(@Cust() cu: CustomerCtx, @Param('id') id: string, @Body() b: any) {
    const { position_sec } = parse(z.object({ position_sec: z.number().int().min(0).max(86400) }), b);
    const l = await this.prisma.lessons.findUniqueOrThrow({ where: { id } });
    await this.enrollment(cu.customerId, l.product_id);
    await this.prisma.lesson_progress.upsert({ where: { customer_id_lesson_id: { customer_id: cu.customerId, lesson_id: id } }, create: { customer_id: cu.customerId, lesson_id: id, product_id: l.product_id, position_sec }, update: { position_sec } });
    await this.prisma.playback_sessions.updateMany({ where: { customer_session_id: cu.sessionId, product_id: l.product_id }, data: { last_seen_at: new Date() } });
    return { ok: true };
  }

  /** Concluir aula; com 100% das obrigatórias emite certificado (RN-94). */
  @Post('lessons/:id/complete') @Customer() @HttpCode(200)
  async complete(@Cust() cu: CustomerCtx, @Param('id') id: string) {
    const l = await this.prisma.lessons.findUniqueOrThrow({ where: { id } });
    await this.enrollment(cu.customerId, l.product_id);
    await this.prisma.lesson_progress.upsert({ where: { customer_id_lesson_id: { customer_id: cu.customerId, lesson_id: id } }, create: { customer_id: cu.customerId, lesson_id: id, product_id: l.product_id, completed_at: new Date() }, update: { completed_at: new Date() } });
    const required = await this.prisma.lessons.findMany({ where: { product_id: l.product_id, required: true }, select: { id: true } });
    const done = await this.prisma.lesson_progress.count({ where: { customer_id: cu.customerId, lesson_id: { in: required.map(r => r.id) }, completed_at: { not: null } } });
    let certificate_code: string | null = null;
    if (required.length && done >= required.length) {
      const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: cu.customerId } });
      const p = await this.prisma.products.findUniqueOrThrow({ where: { id: l.product_id } });
      const cert = await this.prisma.certificates.upsert({ where: { customer_id_product_id: { customer_id: cu.customerId, product_id: l.product_id } }, create: { code: `DMC-${base62(10).toUpperCase()}`, customer_id: cu.customerId, product_id: l.product_id, student_name: c.name, course_name: p.name }, update: {} });
      certificate_code = cert.code;
    }
    return { ok: true, certificate_code };
  }

  @Post('products/:id/end-other-sessions') @Customer() @HttpCode(200)
  async endOthers(@Cust() cu: CustomerCtx, @Param('id') id: string) {
    await this.prisma.playback_sessions.updateMany({ where: { customer_id: cu.customerId, product_id: id, customer_session_id: { not: cu.sessionId } }, data: { ended_at: new Date() } });
    return { ok: true };
  }

  @Get('certificates/:code') @Public()
  async certificate(@Param('code') code: string) {
    const c = await this.prisma.certificates.findUnique({ where: { code } });
    if (!c) throw new AppError('NOT_FOUND');
    const p = await this.prisma.products.findUnique({ where: { id: c.product_id }, include: { workspace: true } });
    return { code: c.code, student_name: c.student_name, course_name: c.course_name, school: p?.workspace.name, issued_at: c.issued_at };
  }
}
