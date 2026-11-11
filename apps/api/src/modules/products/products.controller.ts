import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { AuditService } from '../../infra/audit.service';
import { NotifyService } from '../../infra/notify.service';
import { Producer, Ctx, ProducerCtx, Public, Req as R } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { base62, signToken, verifyToken } from '../../common/crypto';
import { netPerSale, FEES, formatBRL } from '../../domain/money';
import { moderationFlags } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { urls } from '../../common/urls';

const MAX_UPLOAD = 5 * 1024 ** 3; // 5 GB (19.8)
const PART_SIZE = 8 * 1024 ** 2;
const ALLOWED_MIME = /^(video\/(mp4|quicktime|webm)|application\/pdf|image\/(png|jpeg|webp|gif)|audio\/(mpeg|mp4|wav|x-m4a)|application\/zip|application\/epub\+zip)$/;

const OfferPatch = z.object({
  name: z.string().min(1).max(60).optional(),
  price_cents: z.number().int().min(500).max(5_000_000).optional(),
  max_installments: z.number().int().min(1).max(12).optional(),
  installment_interest: z.enum(['buyer', 'producer']).optional(),
  methods: z.array(z.enum(['pix', 'card', 'boleto'])).min(1).optional(),
  guarantee_days: z.number().int().min(7).max(365).optional(),
  sales_limit: z.number().int().min(1).nullable().optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  pix_expiration_min: z.number().int().min(10).max(1440).optional(),
  boleto_due_days: z.number().int().min(1).max(7).optional(),
  thank_you_url: z.string().url().startsWith('https://').nullable().optional(),
  billing_type: z.enum(['one_time', 'subscription']).optional(),
  interval: z.enum(['month', 'quarter', 'semester', 'year']).nullable().optional(),
  trial_days: z.number().int().min(0).max(30).optional(),
  status: z.enum(['active', 'paused', 'ended']).optional(),
  theme: z.object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), logo_url: z.string().url().optional().or(z.literal('')), banner_url: z.string().url().optional().or(z.literal('')),
    testimonials: z.array(z.object({ name: z.string().max(60), text: z.string().max(300) })).max(6).optional(),
    countdown_minutes: z.number().int().min(0).max(1440).optional(),
    pixels: z.object({ meta_pixel_id: z.string().max(30).optional(), meta_capi_token: z.string().max(400).optional(), ga4_id: z.string().max(30).optional(), google_ads_id: z.string().max(40).optional(), tiktok_pixel_id: z.string().max(40).optional() }).optional(),
  }).optional(),
});

@Controller('v1')
export class ProductsController {
  constructor(private prisma: PrismaService, private storage: StorageService, private audit: AuditService, private notify: NotifyService) {}

  private async own(c: ProducerCtx, productId: string) {
    const p = await this.prisma.products.findFirst({ where: { id: productId, workspace_id: c.workspaceId, deleted_at: null } });
    if (!p) throw new AppError('NOT_FOUND'); // checagem de propriedade (IDOR, 11.3)
    return p;
  }
  private async ownOffer(c: ProducerCtx, offerId: string) {
    const o = await this.prisma.offers.findFirst({ where: { id: offerId, workspace_id: c.workspaceId } });
    if (!o) throw new AppError('NOT_FOUND');
    return o;
  }

  @Get('products') @Producer('products.edit')
  async list(@Ctx() c: ProducerCtx) {
    const ps = await this.prisma.products.findMany({ where: { workspace_id: c.workspaceId, deleted_at: null }, include: { offers: true }, orderBy: { created_at: 'desc' } });
    const sales = await this.prisma.$queryRaw<{ product_id: string; n: bigint; s: bigint }[]>`
      SELECT i.product_id, COUNT(*)::bigint n, SUM(i.price_cents)::bigint s FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE o.workspace_id=${c.workspaceId}::uuid AND o.status='paid' GROUP BY i.product_id`;
    return toJSON(ps.map(p => ({ ...p, sales: sales.find(s => s.product_id === p.id) ?? { n: 0, s: 0 }, checkout_url: p.offers[0] ? urls.checkout(p.offers[0].slug) : null })));
  }

  /** Passo 1 de "Criar produto" (19.8, contrato 22.5). Oferta com os padrões da RN-25. */
  @Post('products') @Producer('products.edit')
  async create(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ type: z.enum(['course', 'file', 'service', 'subscription']), name: z.string().min(3).max(90), price_cents: z.number().int().min(500).max(5_000_000), interval: z.enum(['month', 'quarter', 'semester', 'year']).optional() }), b);
    const p = await this.prisma.$transaction(async (tx) => {
      const p = await tx.products.create({ data: { workspace_id: c.workspaceId, type: d.type, name: d.name.trim() } });
      const o = await tx.offers.create({ data: {
        workspace_id: c.workspaceId, product_id: p.id, slug: base62(8), price_cents: BigInt(d.price_cents),
        billing_type: d.type === 'subscription' ? 'subscription' : 'one_time', interval: d.type === 'subscription' ? (d.interval ?? 'month') : null,
        methods: d.type === 'subscription' ? ['card'] : ['pix', 'card'], max_installments: d.type === 'subscription' ? 1 : 12,
      } });
      if (d.type === 'course' || d.type === 'subscription') await tx.course_modules.create({ data: { product_id: p.id, title: 'Módulo 1', position: 0 } });
      return { p, o };
    });
    return toJSON({ product_id: p.p.id, offer_id: p.o.id, status: 'draft', net_per_sale_cents: netPerSale(BigInt(d.price_cents)), moderation_flags: moderationFlags(d.name) });
  }

  @Get('products/:id') @Producer('products.edit')
  async get(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const p = await this.own(c, id);
    const offers = await this.prisma.offers.findMany({ where: { product_id: id }, include: { bumps: true }, orderBy: { created_at: 'asc' } });
    const modules = await this.prisma.course_modules.findMany({ where: { product_id: id }, include: { lessons: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } });
    const files = await this.prisma.product_files.findMany({ where: { product_id: id } });
    const uploads = await this.prisma.uploads.findMany({ where: { product_id: id, status: { not: 'ready' } }, orderBy: { created_at: 'asc' } });
    const coupons = await this.prisma.coupons.findMany({ where: { workspace_id: c.workspaceId }, orderBy: { created_at: 'desc' } });
    const coproductions = await this.prisma.coproductions.findMany({ where: { product_id: id } });
    const affiliations = await this.prisma.affiliations.findMany({ where: { product_id: id } });
    const affUsers = await this.prisma.users.findMany({ where: { id: { in: affiliations.map(a => a.affiliate_user_id) } } });
    const others = await this.prisma.offers.findMany({ where: { workspace_id: c.workspaceId, product_id: { not: id }, status: 'active' }, include: { product: true } });
    return toJSON({
      ...p, offers: offers.map(o => ({ ...o, checkout_url: urls.checkout(o.slug), net_per_sale_cents: netPerSale(o.price_cents) })), modules, files, uploads,
      coupons: coupons.filter(k => !k.offer_ids.length || offers.some(o => k.offer_ids.includes(o.id))), coproductions,
      affiliations: affiliations.map(a => ({ ...a, name: affUsers.find(u => u.id === a.affiliate_user_id)?.name, email: affUsers.find(u => u.id === a.affiliate_user_id)?.email })),
      bump_candidates: others.map(o => ({ offer_id: o.id, name: o.product.name, price_cents: o.price_cents })),
      fee_hint: `Taxa Domma Mart: 4,49% + R$ 1,49 por venda. Sem mensalidade.`,
    });
  }

  @Patch('products/:id') @Producer('products.edit')
  async patch(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    await this.own(c, id);
    const d = parse(z.object({
      name: z.string().min(3).max(90).optional(), description: z.string().max(2000).nullable().optional(), cover_url: z.string().url().nullable().optional().or(z.literal('')),
      service_url: z.string().url().nullable().optional().or(z.literal('')), guarantee_days: z.number().int().min(7).max(365).optional(),
      affiliation_enabled: z.boolean().optional(), affiliation_auto_approve: z.boolean().optional(), affiliate_commission_bps: z.number().int().min(100).max(9000).optional(),
      affiliate_cookie_days: z.number().int().min(1).max(365).optional(), affiliate_attribution: z.enum(['last_click', 'first_click']).optional(),
    }), b);
    const data: any = { ...d };
    if (d.cover_url === '') data.cover_url = null;
    if (d.service_url === '') data.service_url = null;
    const p = await this.prisma.products.update({ where: { id }, data });
    if (d.guarantee_days) await this.prisma.offers.updateMany({ where: { product_id: id }, data: { guarantee_days: d.guarantee_days } });
    // nome ou descrição alterados depois da aprovação passam de novo pela análise automática
    const changed = [d.name, d.description].filter(Boolean).join(' ');
    const flags = changed ? moderationFlags(changed) : [];
    if (p.moderation_status === 'approved' && flags.length) {
      await this.prisma.products.update({ where: { id }, data: { moderation_status: 'in_review', moderation_notes: `Termos: ${flags.join(', ')}` } });
    }
    return toJSON(p);
  }

  @Delete('products/:id') @Producer('products.edit')
  async remove(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    await this.own(c, id);
    await this.prisma.products.update({ where: { id }, data: { deleted_at: new Date() } });
    await this.prisma.offers.updateMany({ where: { product_id: id }, data: { status: 'ended' } });
    return { ok: true };
  }

  /** Publicar (19.8): moderação automática (RN-65) e link de venda. */
  @Post('products/:id/publish') @Producer('products.edit')
  async publish(@Ctx() c: ProducerCtx, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const p = await this.own(c, id);
    if (p.type === 'course' || p.type === 'subscription') {
      if (!(await this.prisma.lessons.count({ where: { product_id: id, status: 'ready' } }))) throw new AppError('VALIDATION_ERROR', { title: 'Envie pelo menos 1 aula antes de publicar.' });
    }
    if (p.type === 'file' && !(await this.prisma.product_files.count({ where: { product_id: id } }))) throw new AppError('VALIDATION_ERROR', { title: 'Envie o arquivo antes de publicar.' });
    const offer = await this.prisma.offers.findFirstOrThrow({ where: { product_id: id }, orderBy: { created_at: 'asc' } });
    const flags = moderationFlags(`${p.name} ${p.description ?? ''}`);
    if (flags.length || p.moderation_status === 'rejected') {
      await this.prisma.products.update({ where: { id }, data: { moderation_status: 'in_review', moderation_notes: flags.length ? `Termos: ${flags.join(', ')}` : p.moderation_notes } });
      await this.prisma.offers.update({ where: { id: offer.id }, data: { status: 'active' } });
      res.status(202);
      return { status: 'in_review', eta_hours: 24 };
    }
    await this.prisma.products.update({ where: { id }, data: { moderation_status: 'approved', published_at: p.published_at ?? new Date() } });
    await this.prisma.offers.updateMany({ where: { product_id: id, status: 'draft' }, data: { status: 'active' } });
    res.status(200);
    return { status: 'active', checkout_url: urls.checkout(offer.slug) };
  }

  @Post('products/:id/offers') @Producer('products.edit')
  async addOffer(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const p = await this.own(c, id);
    const d = parse(OfferPatch.extend({ name: z.string().min(1).max(60), price_cents: z.number().int().min(500).max(5_000_000) }), b);
    const first = await this.prisma.offers.findFirstOrThrow({ where: { product_id: id }, orderBy: { created_at: 'asc' } });
    const o = await this.prisma.offers.create({ data: {
      workspace_id: c.workspaceId, product_id: p.id, slug: base62(8), name: d.name, price_cents: BigInt(d.price_cents),
      billing_type: first.billing_type, interval: first.interval, methods: d.methods ?? first.methods, max_installments: d.max_installments ?? first.max_installments,
      guarantee_days: p.guarantee_days, status: p.moderation_status === 'approved' ? 'active' : 'draft',
    } });
    return toJSON({ ...o, checkout_url: urls.checkout(o.slug) });
  }

  @Patch('offers/:id') @Producer('products.edit')
  async patchOffer(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const o = await this.ownOffer(c, id);
    const d = parse(OfferPatch, b);
    const data: any = { ...d };
    if (d.price_cents != null) data.price_cents = BigInt(d.price_cents);
    if (d.ends_at !== undefined) data.ends_at = d.ends_at ? new Date(d.ends_at) : null;
    if (d.theme) data.theme = { ...((o.theme as any) ?? {}), ...d.theme };
    if (d.price_cents != null && o.billing_type === 'subscription' && BigInt(d.price_cents) !== o.price_cents) {
      // RN-47: novo preço vale só para novos assinantes
    }
    const updated = await this.prisma.offers.update({ where: { id }, data });
    await this.audit.log({ actorId: c.userId, action: 'offer.update', target: `offer:${id}`, before: { price_cents: o.price_cents, methods: o.methods }, after: { price_cents: updated.price_cents, methods: updated.methods } });
    return toJSON({ ...updated, net_per_sale_cents: netPerSale(updated.price_cents) });
  }

  @Put('offers/:id/bumps') @Producer('products.edit')
  async bumps(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    await this.ownOffer(c, id);
    const d = parse(z.object({ items: z.array(z.object({ offer_id: z.string().uuid(), headline: z.string().max(140).optional() })).max(3) }), b); // RN-23
    const valid = await this.prisma.offers.findMany({ where: { id: { in: d.items.map(i => i.offer_id) }, workspace_id: c.workspaceId } });
    await this.prisma.$transaction([
      this.prisma.offer_bumps.deleteMany({ where: { offer_id: id } }),
      ...d.items.filter(i => valid.some(v => v.id === i.offer_id) && i.offer_id !== id).map((i, k) => this.prisma.offer_bumps.create({ data: { offer_id: id, bump_offer_id: i.offer_id, headline: i.headline, position: k } })),
    ]);
    return { ok: true };
  }

  // ───── Cupons (RN-20..22) ─────
  @Post('coupons') @Producer('products.edit')
  async createCoupon(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({
      code: z.string().regex(/^[A-Za-z0-9]{3,20}$/, 'Use de 3 a 20 letras ou números.'), kind: z.enum(['percent', 'fixed']), value: z.number().int().min(1),
      offer_ids: z.array(z.string().uuid()).default([]), ends_at: z.string().datetime({ offset: true }).nullable().optional(),
      max_uses: z.number().int().min(1).nullable().optional(), max_uses_per_cpf: z.number().int().min(1).nullable().optional(),
    }), b);
    if (d.kind === 'percent' && d.value > 9000) throw new AppError('VALIDATION_ERROR', { fields: { value: 'Desconto máximo de 90%.' } });
    const offers = await this.prisma.offers.count({ where: { id: { in: d.offer_ids }, workspace_id: c.workspaceId } });
    if (offers !== d.offer_ids.length) throw new AppError('NOT_FOUND');
    try {
      return toJSON(await this.prisma.coupons.create({ data: { workspace_id: c.workspaceId, code: d.code.toUpperCase(), kind: d.kind, value: d.value, offer_ids: d.offer_ids, ends_at: d.ends_at ? new Date(d.ends_at) : null, max_uses: d.max_uses ?? null, max_uses_per_cpf: d.max_uses_per_cpf ?? null } }));
    } catch (e: any) {
      if (e.code === 'P2002') throw new AppError('VALIDATION_ERROR', { fields: { code: 'Já existe um cupom com este código.' } });
      throw e;
    }
  }

  @Delete('coupons/:id') @Producer('products.edit')
  async deleteCoupon(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    await this.prisma.coupons.updateMany({ where: { id, workspace_id: c.workspaceId }, data: { active: false } });
    return { ok: true };
  }

  // ───── Sócios / coprodução (5.6) ─────
  @Post('products/:id/coproductions') @Producer('products.edit')
  async invite(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const p = await this.own(c, id);
    const d = parse(z.object({ email: z.string().email(), share_bps: z.number().int().min(100).max(9000), ends_at: z.string().datetime({ offset: true }).nullable().optional() }), b);
    if (d.email.toLowerCase() === c.email.toLowerCase()) throw new AppError('VALIDATION_ERROR', { fields: { email: 'Use o e-mail do seu sócio.' } });
    const active = await this.prisma.coproductions.findMany({ where: { product_id: id, status: { in: ['invited', 'active'] } } });
    if (active.reduce((s, x) => s + x.share_bps, 0) + d.share_bps > 9000) throw new AppError('VALIDATION_ERROR', { fields: { share_bps: 'A soma dos sócios não pode passar de 90%.' } });
    const cp = await this.prisma.coproductions.create({ data: { product_id: id, workspace_id: c.workspaceId, invited_email: d.email.toLowerCase(), share_bps: d.share_bps, ends_at: d.ends_at ? new Date(d.ends_at) : null } });
    await this.notify.send({ channel: 'email', to: d.email, template: 'coproduction_invite', workspaceId: c.workspaceId, vars: { produtor: c.name, produto: p.name, percentual: `${d.share_bps / 100}%`, link: `${process.env.APP_URL}/socios/${cp.id}` } });
    await this.audit.log({ actorId: c.userId, action: 'coproduction.invite', target: `product:${id}`, after: { email: d.email, share_bps: d.share_bps } });
    return toJSON(cp);
  }

  @Delete('coproductions/:id') @Producer('products.edit')
  async endCopro(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const cp = await this.prisma.coproductions.findUnique({ where: { id } });
    if (!cp) throw new AppError('NOT_FOUND');
    await this.own(c, cp.product_id);
    await this.prisma.coproductions.update({ where: { id }, data: { status: 'ended' } });
    return { ok: true };
  }

  // ───── Estrutura do curso (5.5) ─────
  @Post('products/:id/modules') @Producer('products.edit')
  async addModule(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    await this.own(c, id);
    const { title } = parse(z.object({ title: z.string().min(1).max(120) }), b);
    const n = await this.prisma.course_modules.count({ where: { product_id: id } });
    return toJSON(await this.prisma.course_modules.create({ data: { product_id: id, title, position: n } }));
  }

  @Patch('modules/:id') @Producer('products.edit')
  async patchModule(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const m = await this.prisma.course_modules.findUniqueOrThrow({ where: { id } });
    await this.own(c, m.product_id);
    const d = parse(z.object({ title: z.string().min(1).max(120).optional(), position: z.number().int().min(0).optional() }), b);
    return toJSON(await this.prisma.course_modules.update({ where: { id }, data: d }));
  }

  @Post('modules/:id/lessons') @Producer('products.edit')
  async addLesson(@Ctx() c: ProducerCtx, @Param('id') moduleId: string, @Body() b: any) {
    const m = await this.prisma.course_modules.findUniqueOrThrow({ where: { id: moduleId } });
    await this.own(c, m.product_id);
    const d = parse(z.object({ title: z.string().min(1).max(160), kind: z.enum(['text', 'link']), body: z.string().max(20000) }), b);
    const n = await this.prisma.lessons.count({ where: { module_id: moduleId } });
    return toJSON(await this.prisma.lessons.create({ data: { module_id: moduleId, product_id: m.product_id, title: d.title, kind: d.kind, body: d.body, position: n } }));
  }

  @Patch('lessons/:id') @Producer('products.edit')
  async patchLesson(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const l = await this.prisma.lessons.findUniqueOrThrow({ where: { id } });
    await this.own(c, l.product_id);
    const d = parse(z.object({ title: z.string().min(1).max(160).optional(), body: z.string().max(20000).nullable().optional(), drip_days: z.number().int().min(0).max(3650).nullable().optional(), drip_date: z.string().datetime({ offset: true }).nullable().optional(), required: z.boolean().optional(), position: z.number().int().min(0).optional(), module_id: z.string().uuid().optional() }), b);
    const data: any = { ...d };
    if (d.drip_date !== undefined) data.drip_date = d.drip_date ? new Date(d.drip_date) : null;
    if (d.module_id) { const m = await this.prisma.course_modules.findFirst({ where: { id: d.module_id, product_id: l.product_id } }); if (!m) throw new AppError('NOT_FOUND'); }
    return toJSON(await this.prisma.lessons.update({ where: { id }, data }));
  }

  @Delete('lessons/:id') @Producer('products.edit')
  async deleteLesson(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const l = await this.prisma.lessons.findUniqueOrThrow({ where: { id } });
    await this.own(c, l.product_id);
    await this.prisma.lesson_progress.deleteMany({ where: { lesson_id: id } });
    await this.prisma.lessons.delete({ where: { id } });
    return { ok: true };
  }

  // ───── Upload em partes (19.8 / 22.5) ─────
  @Post('uploads') @Producer('products.edit')
  async startUpload(@Ctx() c: ProducerCtx, @Body() b: any) {
    const d = parse(z.object({ product_id: z.string().uuid(), filename: z.string().min(1).max(200), size: z.number().int().min(1), mime: z.string().max(100), purpose: z.enum(['content', 'cover', 'attachment']).default('content'), lesson_id: z.string().uuid().optional() }), b);
    await this.own(c, d.product_id);
    if (d.size > MAX_UPLOAD) throw new AppError('UPLOAD_TOO_LARGE');
    if (!ALLOWED_MIME.test(d.mime)) throw new AppError('VALIDATION_ERROR', { title: 'Tipo de arquivo não aceito. Envie vídeo, PDF, imagem ou áudio.' });
    const safe = d.filename.replace(/[^\w.\-]+/g, '_').slice(-80);
    const key = `products/${d.product_id}/${base62(12)}-${safe}`;
    const up = await this.prisma.uploads.create({ data: { workspace_id: c.workspaceId, product_id: d.product_id, filename: d.filename, mime: d.mime, size: BigInt(d.size), storage_key: key, status: 'uploading' } });
    const parts = Math.ceil(d.size / PART_SIZE);
    const exp = Date.now() + 6 * 3600_000;
    return toJSON({
      upload_id: up.id, part_size: PART_SIZE, purpose: d.purpose, lesson_id: d.lesson_id,
      parts: Array.from({ length: parts }, (_, i) => ({ n: i + 1, url: `/v1/uploads/${up.id}/parts/${i + 1}?t=${signToken({ u: up.id, n: i + 1, exp })}` })),
    });
  }

  /** Recebe uma parte (URL pré-assinada). Partes são enviadas em ordem; retomável. */
  @Put('uploads/:id/parts/:n') @Public()
  async part(@Param('id') id: string, @Param('n') n: string, @Query('t') t: string, @Req() req: R) {
    const p = verifyToken<{ u: string; n: number }>(t);
    if (!p || p.u !== id || p.n !== Number(n)) throw new AppError('AUTH_LINK_EXPIRED');
    const up = await this.prisma.uploads.findUniqueOrThrow({ where: { id } });
    if (up.status !== 'uploading') throw new AppError('VALIDATION_ERROR');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > PART_SIZE) throw new AppError('VALIDATION_ERROR');
    const expectedOffset = BigInt((Number(n) - 1) * PART_SIZE);
    if (up.received > expectedOffset) return { ok: true, received: Number(up.received) }; // parte já recebida (retomada)
    if (up.received !== expectedOffset) throw new AppError('VALIDATION_ERROR', { title: 'Parte fora de ordem.', received: Number(up.received) });
    if (Number(n) === 1) {
      // verificação do tipo real pelo conteúdo (11.5)
      if (!magicMatches(body, up.mime)) { await this.prisma.uploads.update({ where: { id }, data: { status: 'error' } }); throw new AppError('VALIDATION_ERROR', { title: 'O conteúdo do arquivo não corresponde ao tipo informado.' }); }
    }
    this.storage.write(up.storage_key, body, Number(n) > 1);
    await this.prisma.uploads.update({ where: { id }, data: { received: up.received + BigInt(body.length) } });
    return { ok: true, received: Number(up.received) + body.length };
  }

  @Post('uploads/:id/complete') @Producer('products.edit') @HttpCode(200)
  async complete(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const d = parse(z.object({ purpose: z.enum(['content', 'cover', 'attachment']).default('content'), lesson_id: z.string().uuid().optional(), module_id: z.string().uuid().optional() }), b ?? {});
    const up = await this.prisma.uploads.findFirst({ where: { id, workspace_id: c.workspaceId } });
    if (!up) throw new AppError('NOT_FOUND');
    if (up.received !== up.size) throw new AppError('VALIDATION_ERROR', { title: 'Upload incompleto.', received: Number(up.received) });
    // Antivírus (ClamAV) e transcodificação de vídeo rodam aqui em produção (Bunny/Cloudflare Stream).
    await this.prisma.uploads.update({ where: { id }, data: { status: 'ready' } });
    const product = await this.own(c, up.product_id);
    if (d.purpose === 'cover') {
      const url = `/v1/public/covers/${up.id}`;
      await this.prisma.products.update({ where: { id: product.id }, data: { cover_url: url } });
      return { kind: 'cover', cover_url: url };
    }
    if (d.purpose === 'attachment' && d.lesson_id) {
      const l = await this.prisma.lessons.findFirstOrThrow({ where: { id: d.lesson_id, product_id: product.id } });
      const att = [...((l.attachments as any[]) ?? []), { name: up.filename, key: up.storage_key, mime: up.mime }];
      await this.prisma.lessons.update({ where: { id: l.id }, data: { attachments: att } });
      return { kind: 'attachment' };
    }
    if (product.type === 'file') {
      const f = await this.prisma.product_files.create({ data: { product_id: product.id, filename: up.filename, storage_key: up.storage_key, mime: up.mime, size: up.size } });
      return toJSON({ kind: 'file', file: f });
    }
    // curso/assinatura: cada arquivo vira uma aula, na ordem de envio
    const mod = d.module_id ? await this.prisma.course_modules.findFirstOrThrow({ where: { id: d.module_id, product_id: product.id } }) : (await this.prisma.course_modules.findFirst({ where: { product_id: product.id }, orderBy: { position: 'desc' } })) ?? (await this.prisma.course_modules.create({ data: { product_id: product.id, title: 'Módulo 1', position: 0 } }));
    const n = await this.prisma.lessons.count({ where: { module_id: mod.id } });
    const kind = up.mime.startsWith('video/') ? 'video' : up.mime === 'application/pdf' ? 'pdf' : up.mime.startsWith('audio/') ? 'audio' : 'file';
    const title = up.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 160) || `Aula ${n + 1}`;
    const lesson = await this.prisma.lessons.create({ data: { module_id: mod.id, product_id: product.id, title, kind, storage_key: up.storage_key, status: 'ready', position: n } });
    return toJSON({ kind: 'lesson', lesson });
  }

  @Get('public/covers/:id') @Public()
  async cover(@Param('id') id: string, @Res() res: Response) {
    const up = await this.prisma.uploads.findUnique({ where: { id } });
    if (!up || !up.mime.startsWith('image/') || up.status !== 'ready') throw new AppError('NOT_FOUND');
    res.set({ 'Content-Type': up.mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    this.storage.stream(up.storage_key).pipe(res);
  }

  // ───── Afiliados do lado do produtor (19.12 e) ─────
  @Post('affiliations/:id/:action') @Producer('affiliates.manage') @HttpCode(200)
  async affAction(@Ctx() c: ProducerCtx, @Param('id') id: string, @Param('action') action: string) {
    const a = await this.prisma.affiliations.findFirst({ where: { id, producer_workspace_id: c.workspaceId } });
    if (!a) throw new AppError('NOT_FOUND');
    if (!['approve', 'block'].includes(action)) throw new AppError('NOT_FOUND');
    await this.prisma.affiliations.update({ where: { id }, data: { status: action === 'approve' ? 'active' : 'blocked' } }); // RN-74
    await this.audit.log({ actorId: c.userId, action: `affiliation.${action}`, target: `affiliation:${id}` });
    return { ok: true };
  }
}

/** Assinaturas de arquivo (magic bytes) para verificação de tipo real. */
function magicMatches(b: Buffer, mime: string): boolean {
  const hex = b.subarray(0, 12).toString('hex');
  if (mime === 'application/pdf') return b.subarray(0, 5).toString() === '%PDF-';
  if (mime === 'image/png') return hex.startsWith('89504e47');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/gif') return b.subarray(0, 3).toString() === 'GIF';
  if (mime === 'image/webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'audio/mp4' || mime === 'audio/x-m4a') return b.subarray(4, 8).toString() === 'ftyp';
  if (mime === 'video/webm') return hex.startsWith('1a45dfa3');
  if (mime === 'audio/mpeg') return hex.startsWith('494433') || hex.startsWith('fff');
  if (mime === 'audio/wav') return b.subarray(0, 4).toString() === 'RIFF';
  if (mime === 'application/zip' || mime === 'application/epub+zip') return hex.startsWith('504b0304');
  return false;
}
export { formatBRL, FEES };
