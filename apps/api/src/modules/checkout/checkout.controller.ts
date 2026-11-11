import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../../infra/prisma.service';
import { Public, Req as R, clientIp } from '../../http/context';
import { AppError } from '../../common/errors';
import { verifyToken, randomToken, sha256, blindIndex } from '../../common/crypto';
import { parse, z } from '../../http/zod';
import { toJSON } from '../../http/json';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import * as rl from '../../infra/rate-limit';
import { hashIp } from '../../common/crypto';

async function verifyTurnstile(token: string | undefined, ip: string) {
  if (!process.env.TURNSTILE_SECRET) return true; // RN-64 — sem chave configurada (dev), ignora
  if (!token) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token, remoteip: ip }) });
  return ((await r.json()) as any).success === true;
}

const OrderSchema = z.object({
  customer: z.object({ name: z.string().max(120), email: z.string().max(200), phone: z.string().max(30), document: z.string().max(20) }),
  method: z.enum(['pix', 'card', 'boleto']),
  installments: z.number().int().min(1).max(12).optional(),
  card_token: z.string().max(500).optional(),
  bump_offer_ids: z.array(z.string().uuid()).max(3).optional(),
  coupon_code: z.string().max(20).optional(),
  tracking: z.record(z.string(), z.string()).optional(),
  affiliate_code: z.string().max(60).optional(),
  device_fingerprint: z.string().max(100).optional(),
});

/** Domínio que o comprador está usando (o site repassa em x-dm-host; o Vercel em x-forwarded-host). */
function requestHost(req: R): string | undefined {
  const h = (req.headers['x-dm-host'] as string) || (req.headers['x-forwarded-host'] as string) || '';
  return h.split(',')[0].trim().toLowerCase() || undefined;
}

function orderFromToken(id: string, t: string | undefined) {
  const p = verifyToken<{ o: string }>(t);
  if (!p || p.o !== id) throw new AppError('AUTH_LINK_EXPIRED');
}

@Controller()
@Public()
export class CheckoutController {
  constructor(private svc: CheckoutService, private prisma: PrismaService, private events: EventEmitter2, @Inject(GATEWAY) private gateway: GatewayAdapter) {}

  @Get('v1/public/offers/:slug')
  async offer(@Param('slug') slug: string, @Query() q: Record<string, string>, @Req() req: R) {
    return toJSON(await this.svc.publicOffer(slug, Object.fromEntries(Object.entries(q).filter(([k]) => /^(utm_|src|ref|fbclid|gclid)/.test(k))), requestHost(req)));
  }

  @Post('v1/public/coupons/validate') @HttpCode(200)
  async coupon(@Body() b: any, @Req() req: R) {
    const { offer_id, code } = parse(z.object({ offer_id: z.string().uuid(), code: z.string().min(3).max(20) }), b);
    await rl.limit(`coupon:${hashIp(clientIp(req))}`, 20, 600);
    return toJSON(await this.svc.validateCoupon(offer_id, code));
  }

  @Post('v1/public/checkout-leads') @HttpCode(200)
  async lead(@Body() b: any) {
    const d = parse(z.object({ offer_id: z.string().uuid(), email: z.string().max(200), name: z.string().max(120).optional(), phone: z.string().max(30).optional() }), b);
    return this.svc.saveLead(d.offer_id, d.email.trim().toLowerCase(), d.name, d.phone);
  }

  @Post('v1/checkout/:offerId/orders')
  async create(@Param('offerId') offerId: string, @Body() b: any, @Req() req: R, @Headers('idempotency-key') idem?: string, @Headers('cf-turnstile-response') captcha?: string) {
    if (!idem || idem.length < 16 || idem.length > 100) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    if (!(await verifyTurnstile(captcha, clientIp(req)))) throw new AppError('RATE_LIMITED');
    const body = parse(OrderSchema, b);
    const r = await this.svc.createOrder(offerId, body, { ip: clientIp(req), ua: String(req.headers['user-agent'] || ''), idempotencyKey: `co:${idem}`, affiliateCookie: req.cookies?.[`dm_aff_${offerId}`] || req.cookies?.dm_aff, host: requestHost(req) });
    return toJSON(r);
  }

  /** Dados da tela Pix gerado (19.2). */
  @Get('v1/orders/:id/pix')
  async pix(@Param('id') id: string, @Query('t') t: string) {
    orderFromToken(id, t);
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id }, include: { payments: { orderBy: { created_at: 'desc' }, take: 1 }, items: true } });
    const p = o.payments[0];
    const product = await this.prisma.products.findUniqueOrThrow({ where: { id: o.items.find(i => i.kind === 'main')!.product_id } });
    return toJSON({
      order_id: o.id, code: o.code, status: o.status, total_cents: o.total_cents, product_name: product.name,
      qr: p?.pix_qr, copy_paste: p?.pix_copy_paste, expires_at: p?.pix_expires_at, server_now: new Date(),
      sandbox: this.gateway.name === 'sandbox' ? { charge_id: p?.provider_charge_id } : null,
      redirect_url: o.status === 'paid' ? `/obrigado/${o.id}?t=${t}` : null,
    });
  }

  @Post('v1/orders/:id/pix/renew') @HttpCode(200)
  async renew(@Param('id') id: string, @Query('t') t: string) {
    orderFromToken(id, t);
    return toJSON(await this.svc.renewPix(id));
  }

  /** SSE de status (22.2). Fallback do cliente: polling a cada 3 s neste mesmo dado via /pix. */
  @Get('v1/orders/:id/events')
  async sse(@Param('id') id: string, @Query('t') t: string, @Res() res: Response) {
    orderFromToken(id, t);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let last = '';
    let closed = false;
    const send = async () => {
      if (closed) return;
      const o = await this.prisma.orders.findUnique({ where: { id }, select: { status: true } });
      if (!o || o.status === last) return;
      last = o.status;
      const payload: any = { status: o.status };
      if (o.status === 'paid') payload.redirect_url = `/obrigado/${id}?t=${t}`;
      res.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const onEvent = (e: { orderId: string }) => { if (e.orderId === id) void send(); };
    this.events.on('order.paid', onEvent);
    this.events.on('order.expired', onEvent);
    const poll = setInterval(() => void send(), 2000);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    await send();
    res.on('close', () => { closed = true; clearInterval(poll); clearInterval(ping); this.events.off('order.paid', onEvent); this.events.off('order.expired', onEvent); });
  }

  /** Página de obrigado (19.3). Purchase do Pixel uma única vez por pedido. */
  @Get('v1/orders/:id')
  async thanks(@Param('id') id: string, @Query('t') t: string) {
    orderFromToken(id, t);
    const o = await this.prisma.orders.findUniqueOrThrow({ where: { id }, include: { items: true, payments: { orderBy: { created_at: 'desc' }, take: 1 } } });
    const customer = await this.prisma.customers.findUniqueOrThrow({ where: { id: o.customer_id } });
    const products = await this.prisma.products.findMany({ where: { id: { in: o.items.map(i => i.product_id) } } });
    const main = products.find(p => p.id === o.items.find(i => i.kind === 'main')!.product_id)!;
    let fire_purchase = false;
    if (o.status === 'paid' && !o.purchase_event_sent_at) {
      const r = await this.prisma.orders.updateMany({ where: { id, purchase_event_sent_at: null }, data: { purchase_event_sent_at: new Date() } });
      fire_purchase = r.count === 1;
    }
    let login_token: string | null = null;
    if (o.status === 'paid') {
      login_token = randomToken(32);
      await this.prisma.customer_auth_tokens.create({ data: { customer_id: o.customer_id, kind: 'order', token_hash: sha256(login_token), expires_at: new Date(Date.now() + 15 * 60_000) } });
    }
    const offer = await this.prisma.offers.findUniqueOrThrow({ where: { id: o.offer_id } });
    const p = o.payments[0];
    return toJSON({
      order_id: o.id, code: o.code, status: o.status, method: o.method, total_cents: o.total_cents, installments: o.installments,
      email: customer.email, product: { id: main.id, name: main.name, type: main.type, service_url: main.service_url },
      items: o.items.map(i => ({ name: products.find(p => p.id === i.product_id)?.name, kind: i.kind, price_cents: i.price_cents })),
      boleto: o.method === 'boleto' ? { line: p?.boleto_line, url: p?.boleto_url, due_at: p?.boleto_due_at } : null,
      thank_you_url: offer.thank_you_url, fire_purchase, login_token,
      sandbox: this.gateway.name === 'sandbox' && o.status === 'pending' ? { charge_id: p?.provider_charge_id } : null,
    });
  }

  /** Link de afiliado (19.10): grava clique, cookie e redireciona ao checkout. */
  @Get('r/:code/:slug')
  async affiliateRedirect(@Param('code') code: string, @Param('slug') slug: string, @Req() req: R, @Res() res: Response) {
    const offer = await this.prisma.offers.findUnique({ where: { slug }, include: { product: true } });
    const aff = offer ? await this.prisma.affiliations.findFirst({ where: { code, product_id: offer.product_id, status: 'active' } }) : null;
    const app = process.env.APP_URL || 'http://localhost:3000';
    if (!offer) return res.redirect(302, app);
    if (aff) {
      await this.prisma.affiliate_clicks.create({ data: { affiliation_id: aff.id, ip_hash: hashIp(clientIp(req)), user_agent: String(req.headers['user-agent'] || '').slice(0, 300) } });
      res.cookie(`dm_aff_${offer.id}`, code, { maxAge: offer.product.affiliate_cookie_days * 86400000, httpOnly: true, sameSite: 'lax', secure: app.startsWith('https') });
    }
    const qs = new URLSearchParams(req.query as Record<string, string>);
    if (aff) qs.set('ref', code);
    return res.redirect(302, `${app}/pay/${slug}?${qs}`);
  }
}
