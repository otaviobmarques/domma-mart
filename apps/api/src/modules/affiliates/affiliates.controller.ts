import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { Producer, Ctx, ProducerCtx, Public } from '../../http/context';
import { AppError } from '../../common/errors';
import { toJSON } from '../../http/json';
import { base62 } from '../../common/crypto';
import { parse, z } from '../../http/zod';
import { NotifyService } from '../../infra/notify.service';
import * as rl from '../../infra/rate-limit';

/** Painel do afiliado (19.10) e pedido de afiliação. */
@Controller('v1')
export class AffiliatesController {
  constructor(private prisma: PrismaService, private ledger: LedgerService, private notify: NotifyService) {}

  /** Página pública de afiliação de um produto (convite do produtor). */
  @Get('public/affiliate-program/:productId') @Public()
  async program(@Param('productId') productId: string) {
    const p = await this.prisma.products.findFirst({ where: { id: productId, affiliation_enabled: true, moderation_status: 'approved', deleted_at: null }, include: { workspace: true, offers: { where: { status: 'active' }, take: 1 } } });
    if (!p) throw new AppError('NOT_FOUND');
    return toJSON({ product_id: p.id, name: p.name, cover_url: p.cover_url, producer: p.workspace.name, commission_bps: p.affiliate_commission_bps, cookie_days: p.affiliate_cookie_days, attribution: p.affiliate_attribution, auto_approve: p.affiliation_auto_approve, price_cents: p.offers[0]?.price_cents });
  }

  @Post('affiliate/request') @Producer() @HttpCode(200)
  async request(@Ctx() c: ProducerCtx, @Body() b: any) {
    const { product_id, message, source } = parse(z.object({ product_id: z.string().uuid(), message: z.string().trim().max(500).optional(), source: z.enum(['invite', 'marketplace']).default('invite') }), b);
    const p = await this.prisma.products.findFirst({ where: { id: product_id, affiliation_enabled: true, deleted_at: null, moderation_status: 'approved' }, include: { workspace: true } });
    if (!p || p.workspace.blocked_at) throw new AppError('NOT_FOUND');
    if (source === 'marketplace' && (!p.marketplace_listed || p.marketplace_delisted_at)) throw new AppError('NOT_FOUND');
    if (p.workspace_id === c.workspaceId) throw new AppError('VALIDATION_ERROR', { title: 'Você não pode se afiliar ao seu próprio produto.' });
    const slugBase = c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 20) || 'afiliado';
    const existing = await this.prisma.affiliations.findUnique({ where: { product_id_affiliate_workspace_id: { product_id, affiliate_workspace_id: c.workspaceId } } });
    if (existing) return toJSON(existing);
    await rl.limit(`affreq:${c.workspaceId}`, 30, 86400); // pedidos em massa a dezenas de produtores
    const a = await this.prisma.affiliations.create({ data: { product_id, producer_workspace_id: p.workspace_id, affiliate_workspace_id: c.workspaceId, affiliate_user_id: c.userId, code: `${slugBase}.${base62(4).toLowerCase()}`, status: p.affiliation_auto_approve ? 'active' : 'pending', message: message || null, source, decided_at: p.affiliation_auto_approve ? new Date() : null } });
    if (a.status === 'pending') {
      // o produtor (dono da conta) recebe o pedido para aprovar
      const owner = await this.prisma.users.findUnique({ where: { id: p.workspace.owner_id } });
      if (owner) void this.notify.send({ channel: 'email', to: owner.email, template: 'affiliation_requested', workspaceId: p.workspace_id, refType: 'affiliation', refId: a.id, vars: { afiliado: c.name, produto: p.name, mensagem: message || '(não informou)', link: `${process.env.APP_URL || ''}/produtos/${p.id}?aba=afiliados` } });
    }
    return toJSON(a);
  }

  /** Materiais de divulgação de um produto (só para afiliado ativo). */
  @Get('affiliate/materials/:productId') @Producer()
  async materials(@Ctx() c: ProducerCtx, @Param('productId') productId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new AppError('NOT_FOUND');
    const a = await this.prisma.affiliations.findUnique({ where: { product_id_affiliate_workspace_id: { product_id: productId, affiliate_workspace_id: c.workspaceId } } });
    if (!a || a.status !== 'active') throw new AppError('NOT_FOUND');
    const p = await this.prisma.products.findUniqueOrThrow({ where: { id: productId } });
    const materials = await this.prisma.affiliate_materials.findMany({ where: { product_id: productId }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] });
    return toJSON({ product: p.name, rules: p.affiliate_rules, materials });
  }

  @Get('affiliate/summary') @Producer()
  async summary(@Ctx() c: ProducerCtx) {
    const affs = await this.prisma.affiliations.findMany({ where: { affiliate_workspace_id: c.workspaceId } });
    const ids = affs.map(a => a.id);
    const clicks = ids.length ? await this.prisma.affiliate_clicks.count({ where: { affiliation_id: { in: ids }, created_at: { gt: new Date(Date.now() - 30 * 86400000) } } }) : 0;
    const [s] = await this.prisma.$queryRaw<{ n: bigint; cents: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint n, COALESCE(SUM(sp.amount_cents),0)::bigint cents FROM orders o JOIN splits sp ON sp.order_id=o.id AND sp.beneficiary_type='affiliate' AND sp.beneficiary_id=${c.workspaceId}::uuid
      WHERE o.paid_at IS NOT NULL AND o.status IN ('paid','chargeback_won')`);
    const bal = await this.ledger.balance(c.workspaceId);
    return toJSON({ clicks_30d: clicks, sales: s.n, commissions_cents: s.cents, incoming_cents: bal.incoming_cents, available_cents: bal.available_cents, affiliations: affs.length });
  }

  @Get('affiliate/links') @Producer()
  async links(@Ctx() c: ProducerCtx) {
    const affs = await this.prisma.affiliations.findMany({ where: { affiliate_workspace_id: c.workspaceId }, orderBy: { created_at: 'desc' } });
    const products = await this.prisma.products.findMany({ where: { id: { in: affs.map(a => a.product_id) } }, include: { workspace: true, offers: { where: { status: 'active' }, orderBy: { created_at: 'asc' }, take: 1 } } });
    const out = [];
    for (const a of affs) {
      const p = products.find(x => x.id === a.product_id)!;
      const clicks = await this.prisma.affiliate_clicks.count({ where: { affiliation_id: a.id } });
      const [s] = await this.prisma.$queryRaw<{ n: bigint; cents: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint n, COALESCE(SUM(sp.amount_cents),0)::bigint cents FROM orders o JOIN order_items i ON i.order_id=o.id AND i.kind='main' AND i.product_id=${a.product_id}::uuid
        JOIN splits sp ON sp.order_id=o.id AND sp.beneficiary_type='affiliate' AND sp.beneficiary_id=${c.workspaceId}::uuid WHERE o.paid_at IS NOT NULL AND o.status IN ('paid','chargeback_won')`);
      const app = process.env.APP_URL || 'http://localhost:3000';
      out.push({
        id: a.id, product_id: p.id, status: a.status, code: a.code, product: p.name, producer: p.workspace.name, cover_url: p.cover_url,
        link: p.offers[0] ? `${app}/r/${a.code}/${p.offers[0].slug}` : null, commission_bps: p.offers[0]?.affiliate_commission_bps ?? p.affiliate_commission_bps, cookie_days: p.affiliate_cookie_days, attribution: p.affiliate_attribution,
        clicks, sales: Number(s.n), conversion_pct: clicks ? Math.round((Number(s.n) / clicks) * 1000) / 10 : 0, commissions_cents: s.cents,
      });
    }
    return toJSON(out);
  }
}
