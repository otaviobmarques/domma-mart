import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, Headers, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../infra/prisma.service';
import { NotifyService } from '../../infra/notify.service';
import { OrdersService } from '../orders/orders.service';
import { Public, Customer, Cust, CustomerCtx, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { randomToken, sha256, blindIndex, hashIp, decrypt, verifyToken, signToken } from '../../common/crypto';
import * as rl from '../../infra/rate-limit';
import { normalizeBRMobile, onlyDigits, isValidDocument } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { cookieOpts } from '../auth/auth.controller';
import { trustedHostHeader } from '../../http/edge';
import { receiptPdf } from './receipt';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';

const SESSION_MS = 30 * 86400000; // RN-82

@Controller('v1/customer')
export class CustomerController {
  constructor(private prisma: PrismaService, private notify: NotifyService, private orders: OrdersService, @Inject(GATEWAY) private gateway: GatewayAdapter) {}

  /**
   * A sessão do comprador só nasce no endereço principal: no domínio próprio de um produtor o cookie ficaria
   * num domínio que ele controla (poderia apontar o DNS para outro servidor e capturar a sessão).
   */
  private mainDomainOnly(req: R) {
    if (trustedHostHeader(req as any)) throw new AppError('PERMISSION_DENIED', { title: 'Para entrar, use o endereço principal da Domma Mart.' });
  }

  private async session(res: Response, customerId: string, req?: R) {
    if (req) this.mainDomainOnly(req);
    const t = randomToken(32);
    await this.prisma.customer_sessions.create({ data: { customer_id: customerId, token_hash: sha256(t), expires_at: new Date(Date.now() + SESSION_MS) } });
    res.cookie('dm_customer', t, cookieOpts(SESSION_MS));
  }

  private async issueMagic(customerId: string, email: string) {
    const token = randomToken(32); // RN-80
    await this.prisma.customer_auth_tokens.create({ data: { customer_id: customerId, kind: 'magic', token_hash: sha256(token), expires_at: new Date(Date.now() + 15 * 60_000) } });
    await this.notify.send({ channel: 'email', to: email, template: 'magic_link', vars: { link: `${process.env.APP_URL}/minhas-compras/entrar?token=${token}` }, refType: 'customer', refId: customerId, sensitive: ['link'] });
  }

  /** Pedir link (19.4). Resposta igual para e-mail cadastrado e não cadastrado. */
  @Post('auth/magic-link') @Public() @HttpCode(200)
  async magic(@Body() b: any, @Req() req: R) {
    const { email } = parse(z.object({ email: z.string().max(200) }), b);
    const e = email.trim().toLowerCase();
    await rl.limit(`magic:e:${blindIndex(e)}`, 5, 900); // RN-83
    await rl.limit(`magic:ip:${hashIp(clientIp(req))}`, 5, 900);
    const c = await this.prisma.customers.findUnique({ where: { email: e } });
    if (c) await this.issueMagic(c.id, c.email);
    return { ok: true, message: 'Se houver compras neste e-mail, enviamos um link.' };
  }

  @Post('auth/otp') @Public() @HttpCode(200)
  async otp(@Body() b: any, @Req() req: R) {
    const { phone } = parse(z.object({ phone: z.string().max(30) }), b);
    const p = normalizeBRMobile(phone);
    if (!p) throw new AppError('VALIDATION_ERROR', { fields: { phone: 'Confira o número com DDD.' } });
    await rl.limit(`otp:p:${blindIndex(p)}`, 5, 900);
    await rl.limit(`otp:ip:${hashIp(clientIp(req))}`, 5, 900);
    if (await rl.isBlocked(`otp:${blindIndex(p)}`)) throw new AppError('RATE_LIMITED');
    const c = await this.prisma.customers.findFirst({ where: { phone_hash: blindIndex(p) }, orderBy: { updated_at: 'desc' } });
    if (c) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0'); // RN-81
      await this.prisma.customer_auth_tokens.create({ data: { customer_id: c.id, kind: 'otp', token_hash: sha256(`${blindIndex(p)}:${code}`), expires_at: new Date(Date.now() + 10 * 60_000) } });
      await this.notify.send({ channel: 'whatsapp', to: p, template: 'otp_code', vars: { codigo: code }, sensitive: ['codigo'] });
    }
    return { ok: true };
  }

  @Post('auth/verify') @Public() @HttpCode(200)
  async verify(@Body() b: any, @Req() req: R, @Res({ passthrough: true }) res: Response) {
    this.mainDomainOnly(req); // antes de gastar o link ou o código
    const d = parse(z.union([z.object({ token: z.string().max(100) }), z.object({ phone: z.string().max(30), code: z.string().length(6) })]), b);
    let row;
    if ('token' in d) {
      row = await this.prisma.customer_auth_tokens.findUnique({ where: { token_hash: sha256(d.token) } });
      if (!row || row.kind !== 'magic' || row.used_at || row.expires_at < new Date()) throw new AppError('AUTH_LINK_EXPIRED');
    } else {
      const p = normalizeBRMobile(d.phone);
      if (!p) throw new AppError('VALIDATION_ERROR');
      const key = blindIndex(p);
      if (await rl.isBlocked(`otp:${key}`)) throw new AppError('RATE_LIMITED');
      row = await this.prisma.customer_auth_tokens.findUnique({ where: { token_hash: sha256(`${key}:${d.code}`) } });
      if (!row || row.used_at || row.expires_at < new Date()) {
        if ((await rl.hit(`otpfail:${key}`, 900)) >= 5) await rl.block(`otp:${key}`, 900); // 5 tentativas → 15 min
        throw new AppError('OTP_INVALID', { title: 'Código incorreto ou expirado.' });
      }
    }
    const used = await this.prisma.customer_auth_tokens.updateMany({ where: { id: row.id, used_at: null }, data: { used_at: new Date() } });
    if (used.count !== 1) throw new AppError('AUTH_LINK_EXPIRED'); // uso único
    await this.session(res, row.customer_id!, req);
    return { ok: true };
  }

  /** "Acessar meu curso" na página de obrigado (19.3). */
  @Post('auth/order-login') @Public() @HttpCode(200)
  async orderLogin(@Body() b: any, @Req() req: R, @Res({ passthrough: true }) res: Response) {
    this.mainDomainOnly(req);
    const { token } = parse(z.object({ token: z.string().max(100) }), b);
    const row = await this.prisma.customer_auth_tokens.findUnique({ where: { token_hash: sha256(token) } });
    if (!row || row.kind !== 'order' || row.used_at || row.expires_at < new Date()) throw new AppError('AUTH_LINK_EXPIRED');
    const used = await this.prisma.customer_auth_tokens.updateMany({ where: { id: row.id, used_at: null }, data: { used_at: new Date() } });
    if (used.count !== 1) throw new AppError('AUTH_LINK_EXPIRED');
    await this.session(res, row.customer_id!, req);
    return { ok: true };
  }

  /** "Não achou uma compra? Buscar pelo CPF" (19.5). */
  @Post('auth/by-document') @Public() @HttpCode(200)
  async byDocument(@Body() b: any, @Req() req: R) {
    const { document } = parse(z.object({ document: z.string().max(20) }), b);
    if (!isValidDocument(document)) throw new AppError('CPF_INVALID');
    await rl.limit(`bydoc:${hashIp(clientIp(req))}`, 5, 900);
    const list = await this.prisma.customers.findMany({ where: { document_hash: blindIndex(onlyDigits(document)) }, take: 5 });
    for (const c of list) await this.issueMagic(c.id, c.email);
    return { ok: true, hints: list.map(c => `${c.email.slice(0, 3)}…`) };
  }

  @Post('auth/logout') @Public() @HttpCode(200)
  async logout(@Req() req: R, @Res({ passthrough: true }) res: Response) {
    const t = req.cookies?.dm_customer;
    if (t) await this.prisma.customer_sessions.updateMany({ where: { token_hash: sha256(t) }, data: { revoked_at: new Date() } });
    res.clearCookie('dm_customer', { path: '/' });
    return { ok: true };
  }

  /** Minhas compras (19.5) — todas as compras do e-mail, de todos os produtores. */
  @Get('purchases') @Customer()
  async purchases(@Cust() cu: CustomerCtx) {
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: cu.customerId } });
    const orders = await this.prisma.orders.findMany({ where: { customer_id: cu.customerId, status: { notIn: ['created', 'failed', 'abandoned'] } }, include: { items: true, payments: { orderBy: { created_at: 'desc' }, take: 1 } }, orderBy: { created_at: 'desc' } });
    const productIds = [...new Set(orders.flatMap(o => o.items.map(i => i.product_id)))];
    const products = await this.prisma.products.findMany({ where: { id: { in: productIds } }, include: { workspace: true } });
    const subs = await this.prisma.subscriptions.findMany({ where: { customer_id: cu.customerId } });
    const refunds = await this.prisma.refunds.findMany({ where: { order_id: { in: orders.map(o => o.id) } } });
    const now = new Date();
    return toJSON({
      first_name: c.name.split(' ')[0],
      pending: orders.filter(o => o.status === 'pending' && ((o.payments[0]?.pix_expires_at ?? o.payments[0]?.boleto_due_at ?? now) > now)).map(o => {
        const p = products.find(x => x.id === o.items[0].product_id)!;
        const tk = (o.method === 'pix' ? `/pix/${o.id}` : `/boleto/${o.id}`);
        return { order_id: o.id, product: p.name, total_cents: o.total_cents, method: o.method, due_at: o.payments[0]?.pix_expires_at ?? o.payments[0]?.boleto_due_at, pay_url: `${tk}?t=${signToken({ o: o.id, exp: Date.now() + 86400000 })}` };
      }),
      purchases: orders.filter(o => o.status !== 'pending' && o.status !== 'expired').map(o => {
        const main = o.items.find(i => i.kind === 'main')!;
        const p = products.find(x => x.id === main.product_id)!;
        const sub = o.subscription_id ? subs.find(s => s.id === o.subscription_id) : null;
        const r = refunds.find(x => x.order_id === o.id);
        return {
          order_id: o.id, code: o.code, status: o.status, method: o.method, total_cents: o.total_cents, created_at: o.created_at, paid_at: o.paid_at, refunded_at: o.refunded_at,
          guarantee_ends_at: o.guarantee_ends_at, in_guarantee: o.status === 'paid' && !!o.guarantee_ends_at && o.guarantee_ends_at > now,
          product: { id: p.id, name: p.name, type: p.type, cover_url: p.cover_url, service_url: p.service_url },
          bumps: o.items.filter(i => i.kind === 'bump').map(i => ({ product_id: i.product_id, name: products.find(x => x.id === i.product_id)?.name, type: products.find(x => x.id === i.product_id)?.type })),
          seller: { name: p.workspace.name, whatsapp: p.workspace.support_whatsapp, email: p.workspace.support_email },
          refund: r ? { status: r.status, created_at: r.created_at } : null,
          subscription: sub ? { id: sub.id, status: sub.status, price_cents: sub.price_cents, card_brand: sub.card_brand, card_last4: sub.card_last4, next_charge_at: sub.next_charge_at, current_period_end: sub.current_period_end, cancel_at_period_end: sub.cancel_at_period_end } : null,
        };
      }),
    });
  }

  @Post('orders/:id/refund') @Customer() @HttpCode(202)
  async refund(@Cust() cu: CustomerCtx, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') idem?: string) {
    if (!idem) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    const { reason } = parse(z.object({ reason: z.enum(['prefer_not_say', 'not_expected', 'bought_by_mistake', 'access_problem']).optional() }), b ?? {});
    return toJSON(await this.orders.refund(id, 'customer', { customerId: cu.customerId, reason }));
  }

  @Post('subscriptions/:id/cancel') @Customer() @HttpCode(200)
  async cancel(@Cust() cu: CustomerCtx, @Param('id') id: string) {
    const s = await this.prisma.subscriptions.findFirst({ where: { id, customer_id: cu.customerId } });
    if (!s) throw new AppError('NOT_FOUND');
    await this.prisma.subscriptions.update({ where: { id }, data: { cancel_at_period_end: true } }); // RN-46
    return { ok: true, access_until: s.current_period_end };
  }

  @Patch('subscriptions/:id/card') @Customer()
  async card(@Cust() cu: CustomerCtx, @Param('id') id: string, @Body() b: any) {
    const { card_token } = parse(z.object({ card_token: z.string().max(500) }), b);
    const s = await this.prisma.subscriptions.findFirst({ where: { id, customer_id: cu.customerId } });
    if (!s) throw new AppError('NOT_FOUND');
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: cu.customerId } });
    let saved;
    try { saved = await this.gateway.saveCard!({ customer: { name: c.name, email: c.email, document: decrypt(c.document_enc), phone: decrypt(c.phone_enc) }, cardToken: card_token }); }
    catch { throw new AppError('VALIDATION_ERROR', { fields: { card_token: 'Não conseguimos validar este cartão. Confira os dados.' } }); }
    await this.prisma.subscriptions.update({ where: { id }, data: { card_token_ref: saved.tokenRef, card_brand: saved.brand, card_last4: saved.last4, ...(s.status === 'past_due' ? { next_charge_at: new Date() } : {}) } });
    return { ok: true };
  }

  /** Cartões guardados para a compra com 1 clique (só bandeira e final). */
  @Get('cards') @Customer()
  async cards(@Cust() cu: CustomerCtx) {
    const cards = await this.prisma.saved_cards.findMany({ where: { customer_id: cu.customerId, revoked_at: null }, orderBy: { created_at: 'desc' } });
    return toJSON(cards.map(k => ({ id: k.id, brand: k.brand, last4: k.last4, created_at: k.created_at, last_used_at: k.last_used_at })));
  }

  /** Remover cartão guardado (LGPD: o comprador revoga o consentimento quando quiser). */
  @Delete('cards/:id') @Customer() @HttpCode(200)
  async removeCard(@Cust() cu: CustomerCtx, @Param('id') id: string) {
    const r = await this.prisma.saved_cards.updateMany({ where: { id, customer_id: cu.customerId, revoked_at: null }, data: { revoked_at: new Date() } });
    if (!r.count) throw new AppError('NOT_FOUND');
    return { ok: true };
  }

  @Get('orders/:id/receipt.pdf') @Customer()
  async receipt(@Cust() cu: CustomerCtx, @Param('id') id: string, @Res() res: Response) {
    const o = await this.prisma.orders.findFirst({ where: { id, customer_id: cu.customerId }, include: { items: true } });
    if (!o || !o.paid_at) throw new AppError('NOT_FOUND');
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: cu.customerId } });
    const products = await this.prisma.products.findMany({ where: { id: { in: o.items.map(i => i.product_id) } }, include: { workspace: true } });
    const pdf = receiptPdf({ code: o.code, paidAt: o.paid_at, method: o.method, installments: o.installments, total: o.total_cents, seller: products[0].workspace.name, buyer: c.name, buyerEmail: c.email, items: o.items.map(i => ({ name: products.find(p => p.id === i.product_id)!.name, price: i.price_cents })), interest: o.interest_cents });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="recibo-${o.code}.pdf"` }).send(pdf);
  }
}

/** Descadastro de comunicações de recuperação (RN-41, LGPD). */
@Controller('v1/public')
@Public()
export class OptOutController {
  constructor(private prisma: PrismaService) {}
  @Post('opt-out') @HttpCode(200)
  async optOut(@Body() b: any) {
    const { t } = parse(z.object({ t: z.string().max(500) }), b);
    const p = verifyToken<{ e: string }>(t);
    if (!p) throw new AppError('AUTH_LINK_EXPIRED');
    await this.prisma.opt_outs.upsert({ where: { key_hash: blindIndex(p.e) }, create: { key_hash: blindIndex(p.e) }, update: {} });
    const c = await this.prisma.customers.findUnique({ where: { email: p.e } });
    if (c) await this.prisma.opt_outs.upsert({ where: { key_hash: blindIndex(decrypt(c.phone_enc)) }, create: { key_hash: blindIndex(decrypt(c.phone_enc)) }, update: {} });
    return { ok: true };
  }
}
