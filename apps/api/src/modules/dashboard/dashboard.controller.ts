import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { FinanceService } from '../finance/finance.service';
import { OrdersService } from '../orders/orders.service';
import { NotifyService } from '../../infra/notify.service';
import { Producer, Ctx, ProducerCtx, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { decrypt, hashIp, blindIndex } from '../../common/crypto';
import { statusLabel, OrderStatus } from '../../domain/order-state';
import { maskEmail, maskPhone, maskDocument, onlyDigits } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { urls } from '../../common/urls';
import { redis } from '../../infra/redis';

const tz = 'America/Sao_Paulo';

@Controller('v1')
export class DashboardController {
  constructor(private prisma: PrismaService, private ledger: LedgerService, private finance: FinanceService, private orders: OrdersService, private notify: NotifyService) {}

  /** Início (19.7): quanto vendi, quanto posso sacar, o que falta fazer. Cache de 60 s. */
  @Get('dashboard/summary') @Producer('dashboard.view')
  async summary(@Ctx() c: ProducerCtx) {
    const ck = `dash:${c.workspaceId}`;
    const cached = await redis().get(ck);
    if (cached) return JSON.parse(cached);
    const [m] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH b AS (SELECT
        date_trunc('month', now() AT TIME ZONE ${tz}) AS m0,
        date_trunc('month', now() AT TIME ZONE ${tz}) - interval '1 month' AS m1,
        (now() AT TIME ZONE ${tz}) - interval '1 month' AS same_point,
        date_trunc('day', now() AT TIME ZONE ${tz}) AS d0)
      SELECT
        COALESCE(SUM(o.total_cents) FILTER (WHERE (o.paid_at AT TIME ZONE ${tz}) >= b.m0),0)::bigint AS month_cents,
        COUNT(*) FILTER (WHERE (o.paid_at AT TIME ZONE ${tz}) >= b.m0)::int AS month_count,
        COALESCE(SUM(o.total_cents) FILTER (WHERE (o.paid_at AT TIME ZONE ${tz}) >= b.m1 AND (o.paid_at AT TIME ZONE ${tz}) < b.same_point),0)::bigint AS prev_cents,
        COALESCE(SUM(o.total_cents) FILTER (WHERE (o.paid_at AT TIME ZONE ${tz}) >= b.d0),0)::bigint AS today_cents,
        COUNT(*) FILTER (WHERE (o.paid_at AT TIME ZONE ${tz}) >= b.d0)::int AS today_count
      FROM orders o, b WHERE o.workspace_id=${c.workspaceId}::uuid AND o.status IN ('paid','refund_requested','chargeback','chargeback_won')`);
    const bal = await this.ledger.balance(c.workspaceId);
    const prev = Number(m.prev_cents);
    const cmp = prev > 0 ? Math.round(((Number(m.month_cents) - prev) / prev) * 100) : null;
    const pixGen = await this.prisma.orders.count({ where: { workspace_id: c.workspaceId, method: 'pix', created_at: { gt: new Date(Date.now() - 7 * 86400000) }, status: { not: 'created' } } });
    const pixPaid = await this.prisma.orders.count({ where: { workspace_id: c.workspaceId, method: 'pix', created_at: { gt: new Date(Date.now() - 7 * 86400000) }, paid_at: { not: null } } });
    const recovered = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT o.id)::bigint n FROM orders o JOIN notifications n ON n.ref_id=o.id::text AND n.template IN ('recovery','pix_unpaid') WHERE o.workspace_id=${c.workspaceId}::uuid AND o.paid_at > n.created_at AND o.paid_at > now() - interval '7 days'`;
    // Dica da Domma IA: só usa métricas calculadas, nunca inventa números
    let tip: string | null = null;
    if (pixGen >= 5) tip = `Nos últimos 7 dias, ${pixPaid} de ${pixGen} Pix gerados foram pagos (${Math.round((pixPaid / pixGen) * 100)}%). ${Number(recovered[0].n) ? `A recuperação por WhatsApp e e-mail trouxe de volta ${recovered[0].n} venda(s).` : 'Ative a recuperação de vendas para lembrar quem não pagou.'}`;
    const result = toJSON({
      month: { cents: m.month_cents, count: m.month_count, compare_pct: cmp },
      today: { cents: m.today_cents, count: m.today_count },
      balance: bal, tip,
    });
    await redis().set(ck, JSON.stringify(result), 'EX', 60);
    return result;
  }

  @Get('onboarding/steps') @Producer('dashboard.view')
  async steps(@Ctx() c: ProducerCtx) {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: c.workspaceId } });
    const firstProduct = await this.prisma.products.findFirst({ where: { workspace_id: c.workspaceId, deleted_at: null, moderation_status: 'approved' }, include: { offers: true }, orderBy: { created_at: 'asc' } });
    const payout = await this.prisma.payout_accounts.findUnique({ where: { workspace_id: c.workspaceId } });
    const sales = await this.prisma.orders.count({ where: { workspace_id: c.workspaceId, paid_at: { not: null } } });
    const views = firstProduct ? await this.prisma.checkout_views.count({ where: { offer_id: firstProduct.offers[0]?.id } }) : 0;
    const steps = [
      { key: 'identity', label: 'Confirmar sua identidade', done: ws.kyc_status === 'approved', pending_review: ws.kyc_status === 'in_review', href: '/identidade' },
      { key: 'product', label: 'Criar seu primeiro produto', done: !!firstProduct, href: '/produtos/novo' },
      { key: 'pix', label: 'Cadastrar sua chave Pix', done: !!payout, href: '/financeiro' },
      { key: 'share', label: 'Divulgar seu link de venda', done: views > 0 || sales > 0, href: firstProduct ? urls.checkout(firstProduct.offers[0].slug) : '/produtos/novo' },
    ];
    return { steps, hide: steps.every(s => s.done) && sales > 0, first_link: firstProduct?.offers[0] ? urls.checkout(firstProduct.offers[0].slug) : null };
  }

  // ───── Vendas (19.12 c) ─────
  @Get('orders') @Producer('orders.view')
  async list(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>) {
    const where = await this.filters(c, q);
    const limit = Math.min(Number(q.limit) || 25, 100);
    const rows = await this.prisma.orders.findMany({ where: { ...where, ...(q.cursor ? { id: { lt: q.cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1, include: { items: true } });
    const page = rows.slice(0, limit);
    const customers = await this.prisma.customers.findMany({ where: { id: { in: page.map(o => o.customer_id) } } });
    const products = await this.prisma.products.findMany({ where: { id: { in: page.flatMap(o => o.items.map(i => i.product_id)) } } });
    const canSeePII = c.permissions.includes('orders.refund') || c.role === 'owner';
    return toJSON({
      data: page.map(o => {
        const cu = customers.find(x => x.id === o.customer_id)!;
        const main = products.find(p => p.id === o.items.find(i => i.kind === 'main')?.product_id);
        return { id: o.id, code: o.code, created_at: o.created_at, paid_at: o.paid_at, customer: canSeePII ? cu.name : cu.name.split(' ')[0], email: canSeePII ? cu.email : maskEmail(cu.email), product: main?.name, method: o.method, total_cents: o.total_cents, status: o.status, status_label: statusLabel(o.status as OrderStatus), affiliate: !!o.affiliate_workspace_id };
      }),
      next_cursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  }

  private async filters(c: ProducerCtx, q: Record<string, string>): Promise<Prisma.ordersWhereInput> {
    // por padrão, tentativas recusadas não aparecem como venda (4.2); filtre por status para vê-las
    const w: Prisma.ordersWhereInput = { workspace_id: c.workspaceId, status: { notIn: ['created', 'failed', 'abandoned'] } };
    if (q.status) w.status = { in: q.status.split(',') as any };
    if (q.method) w.method = q.method as any;
    if (q.from || q.to) w.created_at = { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined };
    if (q.product_id) w.items = { some: { product_id: q.product_id } };
    if (q.affiliate === '1') w.affiliate_workspace_id = { not: null };
    if (q.utm_source) w.tracking = { path: ['utm_source'], equals: q.utm_source };
    if (q.q) {
      const s = q.q.trim();
      const digits = onlyDigits(s);
      const custs = await this.prisma.customers.findMany({ where: { OR: [{ name: { contains: s, mode: 'insensitive' } }, { email: { contains: s.toLowerCase() } }, ...(digits.length >= 11 ? [{ document_hash: blindIndex(digits) }] : [])] }, select: { id: true }, take: 500 });
      w.OR = [{ code: { contains: s.toUpperCase() } }, { customer_id: { in: custs.map(x => x.id) } }];
    }
    return w;
  }

  @Get('orders/export.csv') @Producer('orders.view')
  async exportCsv(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>, @Res() res: Response) {
    const rows = await this.prisma.orders.findMany({ where: await this.filters(c, q), orderBy: { created_at: 'desc' }, take: 50_000, include: { items: true } });
    const customers = await this.prisma.customers.findMany({ where: { id: { in: rows.map(o => o.customer_id) } } });
    const products = await this.prisma.products.findMany({ where: { workspace_id: c.workspaceId } });
    const full = c.role === 'owner' && q.full === '1'; // dados pessoais mascarados por padrão (12.1)
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };
    const lines = [['codigo', 'criado_em', 'pago_em', 'comprador', 'email', 'telefone', 'cpf', 'produto', 'meio', 'parcelas', 'valor', 'status', 'utm_source', 'utm_campaign'].join(',')];
    for (const o of rows) {
      const cu = customers.find(x => x.id === o.customer_id)!;
      const t = (o.tracking as any) ?? {};
      const phone = decrypt(cu.phone_enc), doc = decrypt(cu.document_enc);
      lines.push([o.code, o.created_at.toISOString(), o.paid_at?.toISOString(), cu.name, full ? cu.email : maskEmail(cu.email), full ? phone : maskPhone(phone), full ? doc : maskDocument(doc), products.find(p => p.id === o.items[0]?.product_id)?.name, o.method, o.installments, (Number(o.total_cents) / 100).toFixed(2), statusLabel(o.status as OrderStatus), t.utm_source, t.utm_campaign].map(esc).join(','));
    }
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="vendas.csv"' }).send('﻿' + lines.join('\n'));
  }

  @Get('orders/:id/detail') @Producer('orders.view')
  async detail(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const o = await this.prisma.orders.findFirst({ where: { id, workspace_id: c.workspaceId }, include: { items: true, splits: true, events: { orderBy: { created_at: 'asc' } }, payments: { orderBy: { created_at: 'asc' } } } });
    if (!o) throw new AppError('NOT_FOUND');
    const cu = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    const products = await this.prisma.products.findMany({ where: { id: { in: o.items.map(i => i.product_id) } } });
    const ws = await this.prisma.workspaces.findMany({ where: { id: { in: o.splits.map(s => s.beneficiary_id).filter(Boolean) as string[] } } });
    const firstLesson = await this.prisma.lesson_progress.findFirst({ where: { customer_id: o.customer_id, product_id: { in: products.map(p => p.id) } }, orderBy: { created_at: 'asc' } });
    const timeline = o.events.map(e => ({ at: e.created_at, event: e.event, label: ({ 'order.created': 'Pedido criado', 'payment.created': o.method === 'pix' ? 'Pix gerado' : o.method === 'boleto' ? 'Boleto gerado' : 'Pagamento em análise', 'payment.confirmed': 'Pago', 'payment.declined': 'Cartão recusado', 'payment.expired': 'Pix expirou', 'pix.renewed': 'Novo Pix gerado', 'refund.requested': 'Reembolso pedido', 'refund.done': 'Reembolsado', 'refund.failed': 'Reembolso falhou', 'chargeback.opened': 'Cliente contestou a compra', 'chargeback.won': 'Contestação ganha', 'chargeback.lost': 'Contestação perdida' } as Record<string, string>)[e.event] ?? e.event }));
    if (firstLesson) timeline.push({ at: firstLesson.created_at, event: 'members.first_lesson', label: 'Acessou a primeira aula' });
    timeline.sort((a, b) => a.at.getTime() - b.at.getTime());
    const full = c.permissions.includes('orders.refund');
    const phone = decrypt(cu.phone_enc);
    return toJSON({
      id: o.id, code: o.code, status: o.status, status_label: statusLabel(o.status as OrderStatus), method: o.method, installments: o.installments,
      subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, interest_cents: o.interest_cents, total_cents: o.total_cents,
      created_at: o.created_at, paid_at: o.paid_at, guarantee_ends_at: o.guarantee_ends_at, tracking: o.tracking,
      customer: { name: cu.name, email: full ? cu.email : maskEmail(cu.email), phone: full ? phone : maskPhone(phone), document: maskDocument(decrypt(cu.document_enc)), whatsapp_url: full ? `https://wa.me/${onlyDigits(phone)}` : null },
      items: o.items.map(i => ({ product: products.find(p => p.id === i.product_id)?.name, kind: i.kind, price_cents: i.price_cents, status: i.status })),
      splits: o.splits.map(s => ({ type: s.beneficiary_type, label: s.beneficiary_type === 'platform' ? 'Taxa Domma Mart' + (o.interest_cents > 0n ? ' + juros do parcelamento' : '') : s.beneficiary_type === 'producer' ? 'Você recebe' : s.beneficiary_type === 'affiliate' ? `Afiliado (${ws.find(w => w.id === s.beneficiary_id)?.name ?? ''})` : `Sócio (${ws.find(w => w.id === s.beneficiary_id)?.name ?? ''})`, amount_cents: s.amount_cents })),
      payment: o.payments.at(-1) && { card_brand: o.payments.at(-1)!.card_brand, card_last4: o.payments.at(-1)!.card_last4, decline_code: o.payments.at(-1)!.decline_code },
      timeline,
    });
  }

  /** Reembolso pelo produtor; acima de R$ 1.000 exige 2FA (19.12 c). */
  @Post('orders/:id/refund') @Producer('orders.refund') @HttpCode(202)
  async refund(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any, @Headers('x-otp') otp?: string, @Headers('idempotency-key') idem?: string) {
    if (!idem) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    const { reason } = parse(z.object({ reason: z.string().max(300).optional() }), b ?? {});
    const o = await this.prisma.orders.findFirst({ where: { id, workspace_id: c.workspaceId } });
    if (!o) throw new AppError('NOT_FOUND');
    if (o.total_cents > 100_000n) await this.finance.checkOtp(c.userId, otp);
    return toJSON(await this.orders.refund(id, 'producer', { workspaceId: c.workspaceId, actorId: c.userId, reason }));
  }

  @Post('orders/:id/resend-access') @Producer('orders.view') @HttpCode(200)
  async resend(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const o = await this.prisma.orders.findFirst({ where: { id, workspace_id: c.workspaceId, status: 'paid' }, include: { items: true } });
    if (!o) throw new AppError('NOT_FOUND');
    const cu = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    const p = await this.prisma.products.findUniqueOrThrow({ where: { id: o.items[0].product_id }, include: { workspace: true } });
    await this.notify.send({ channel: 'email', to: cu.email, template: 'purchase_approved', workspaceId: c.workspaceId, refType: 'order', refId: o.id, vars: { primeiro_nome: cu.name.split(' ')[0], produto: p.name, link_acesso: urls.customerArea(), produtor: p.workspace.name, contato: p.workspace.support_whatsapp || p.workspace.support_email || '' } });
    return { ok: true };
  }

  @Get('reports/overview') @Producer('orders.view')
  async report(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>) {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86400000);
    const to = q.to ? new Date(q.to) : new Date();
    const [r] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(total_cents) FILTER (WHERE paid_at IS NOT NULL AND status NOT IN ('refunded','chargeback_lost')),0)::bigint gross,
        COUNT(*) FILTER (WHERE paid_at IS NOT NULL AND status NOT IN ('refunded','chargeback_lost'))::int approved,
        COUNT(*) FILTER (WHERE method='card')::int card_attempts,
        COUNT(*) FILTER (WHERE method='card' AND paid_at IS NOT NULL)::int card_paid,
        COUNT(*) FILTER (WHERE method='pix')::int pix_generated,
        COUNT(*) FILTER (WHERE method='pix' AND paid_at IS NOT NULL)::int pix_paid,
        COUNT(*) FILTER (WHERE status='refunded')::int refunds
      FROM orders WHERE workspace_id=${c.workspaceId}::uuid AND created_at BETWEEN ${from} AND ${to} AND status <> 'created'`);
    const [net] = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(s.amount_cents),0)::bigint n FROM splits s JOIN orders o ON o.id=s.order_id
      WHERE o.workspace_id=${c.workspaceId}::uuid AND s.beneficiary_type='producer' AND o.paid_at IS NOT NULL AND o.status NOT IN ('refunded','chargeback_lost') AND o.created_at BETWEEN ${from} AND ${to}`);
    const views = await this.prisma.checkout_views.count({ where: { workspace_id: c.workspaceId, created_at: { gte: from, lte: to } } });
    const bySource = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COALESCE(tracking->>'utm_source','(direto)') source, COUNT(*)::int n, COALESCE(SUM(total_cents),0)::bigint cents
      FROM orders WHERE workspace_id=${c.workspaceId}::uuid AND paid_at IS NOT NULL AND created_at BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY 3 DESC LIMIT 10`);
    const byDay = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', paid_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') d, COALESCE(SUM(total_cents),0)::bigint cents, COUNT(*)::int n
      FROM orders WHERE workspace_id=${c.workspaceId}::uuid AND paid_at BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY 1`);
    return toJSON({
      gross_cents: r.gross, net_cents: net.n, approved: r.approved, avg_ticket_cents: r.approved ? Math.round(Number(r.gross) / r.approved) : 0,
      checkout_conversion_pct: views ? Math.round((r.approved / views) * 1000) / 10 : null,
      card_approval_pct: r.card_attempts ? Math.round((r.card_paid / r.card_attempts) * 1000) / 10 : null,
      pix: { generated: r.pix_generated, paid: r.pix_paid }, refunds: r.refunds, views, by_source: bySource, by_day: byDay,
    });
  }

  // ───── Financeiro (19.9) ─────
  @Get('finance/balance') @Producer('finance.view')
  async balance(@Ctx() c: ProducerCtx) {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: c.workspaceId } });
    return toJSON({ ...(await this.finance.balance(c.workspaceId)), kyc_status: ws.kyc_status, totp_enabled: c.totpEnabled, payout_account: await this.finance.payoutAccount(c.workspaceId), incoming_by_date: await this.ledger.incomingByDate(c.workspaceId) });
  }

  @Get('finance/ledger') @Producer('finance.view')
  async movements(@Ctx() c: ProducerCtx, @Query() q: Record<string, string>) {
    const rows = await this.ledger.movements(c.workspaceId, { from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, cursor: q.cursor, limit: Number(q.limit) || 50 });
    const wds = await this.prisma.withdrawals.findMany({ where: { workspace_id: c.workspaceId, status: 'processing' } });
    return toJSON({
      data: rows.map(r => ({ id: r.id, at: r.created_at, description: r.description, amount_cents: r.credit_cents - r.debit_cents, bucket: r.bucket, available_at: r.available_at, kind: r.reference_type })),
      processing_withdrawals: wds.map(w => ({ id: w.id, amount_cents: w.amount_cents, at: w.created_at })),
      next_cursor: rows.length ? rows[rows.length - 1].id : null,
    });
  }

  @Get('finance/ledger.csv') @Producer('finance.view')
  async movementsCsv(@Ctx() c: ProducerCtx, @Res() res: Response) {
    const rows = await this.ledger.movements(c.workspaceId, { limit: 500 });
    const lines = ['quando,o_que_aconteceu,valor,pode_sacar_em', ...rows.map(r => [r.created_at.toISOString(), `"${r.description.replace(/"/g, '""')}"`, (Number(r.credit_cents - r.debit_cents) / 100).toFixed(2), r.available_at.toISOString()].join(','))];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="movimentacoes.csv"' }).send('﻿' + lines.join('\n'));
  }

  @Post('finance/withdrawals') @Producer('finance.withdraw')
  async withdraw(@Ctx() c: ProducerCtx, @Body() b: any, @Req() req: R, @Headers('x-otp') otp?: string, @Headers('idempotency-key') idem?: string) {
    if (!idem) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    const { amount_cents } = parse(z.object({ amount_cents: z.number().int().min(1) }), b);
    return toJSON(await this.finance.withdraw(c.workspaceId, c.userId, BigInt(amount_cents), otp, `wd:${c.workspaceId}:${idem}`, hashIp(clientIp(req))));
  }

  @Put('finance/payout-account') @Producer('finance.withdraw')
  async payout(@Ctx() c: ProducerCtx, @Body() b: any, @Req() req: R, @Headers('x-otp') otp?: string) {
    const d = parse(z.object({
      pix_key: z.string().min(5).max(120).optional(),
      bank: z.object({
        bank: z.string().regex(/^\d{3}$/, 'Código do banco com 3 números.'), branch: z.string().regex(/^\d{1,4}$/, 'Agência sem o dígito, até 4 números.'), branch_digit: z.string().regex(/^[0-9Xx]$/).optional(),
        account: z.string().regex(/^\d{1,13}$/, 'Número da conta, até 13 números.'), account_digit: z.string().regex(/^[0-9Xx]{1,2}$/, 'Dígito da conta.'), type: z.enum(['checking', 'savings']),
      }).optional(),
    }), b);
    if (d.bank) return toJSON(await this.finance.setBankAccount(c.workspaceId, c.userId, { bank: d.bank.bank, branch: d.bank.branch, branchDigit: d.bank.branch_digit, account: d.bank.account, accountDigit: d.bank.account_digit.toUpperCase(), type: d.bank.type }, otp, hashIp(clientIp(req))));
    if (!d.pix_key) throw new AppError('VALIDATION_ERROR', { fields: { pix_key: 'Informe a chave Pix.' } });
    return toJSON(await this.finance.setPayoutAccount(c.workspaceId, c.userId, d.pix_key, otp, hashIp(clientIp(req))));
  }
}
