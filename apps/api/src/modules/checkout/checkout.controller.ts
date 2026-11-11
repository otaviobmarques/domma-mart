import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CheckoutService } from './checkout.service';
import { FunnelService } from './funnel.service';
import { PrismaService } from '../../infra/prisma.service';
import { Public, Req as R, clientIp } from '../../http/context';
import { trustedHostHeader } from '../../http/edge';
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
  customer: z.object({ name: z.string().max(120), email: z.string().max(200), phone: z.string().max(30), document: z.string().max(20) }).optional(),
  save_card: z.boolean().optional(),
  one_click: z.object({ token: z.string().max(600), card_id: z.string().uuid() }).optional(),
  billing_address: z.object({
    zip: z.string().regex(/^\d{5}-?\d{3}$/), street: z.string().min(2).max(120), number: z.string().min(1).max(10), complement: z.string().max(60).optional(),
    district: z.string().min(2).max(60), city: z.string().min(2).max(60), state: z.string().regex(/^[A-Za-z]{2}$/),
  }).optional(),
  three_ds: z.object({ transaction_id: z.string().min(8).max(256), status: z.string().max(2) }).optional(),
  method: z.enum(['pix', 'card', 'boleto']),
  installments: z.number().int().min(1).max(12).optional(),
  card_token: z.string().max(500).optional(),
  bump_offer_ids: z.array(z.string().uuid()).max(3).optional(),
  coupon_code: z.string().max(20).optional(),
  tracking: z.record(z.string(), z.string()).optional(),
  affiliate_code: z.string().max(60).optional(),
  device_fingerprint: z.string().max(100).optional(),
});

/** Domínio próprio do produtor em uso (o proxy do site repassa em x-dm-host). */
function requestHost(req: R): string | undefined {
  return trustedHostHeader(req as any);
}

function orderFromToken(id: string, t: string | undefined) {
  const p = verifyToken<{ o: string }>(t);
  if (!p || p.o !== id) throw new AppError('AUTH_LINK_EXPIRED');
}

@Controller()
@Public()
export class CheckoutController {
  constructor(private svc: CheckoutService, private funnel: FunnelService, private prisma: PrismaService, private events: EventEmitter2, @Inject(GATEWAY) private gateway: GatewayAdapter) {}

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
  async lead(@Body() b: any, @Req() req: R) {
    const d = parse(z.object({ offer_id: z.string().uuid(), email: z.string().max(200), name: z.string().max(120).optional(), phone: z.string().max(30).optional() }), b);
    // limites: o lead dispara e-mails de recuperação, então não pode virar disparador de spam
    await rl.limit(`lead:ip:${hashIp(clientIp(req))}`, 20, 3600);
    await rl.limit(`lead:email:${blindIndex(d.email.trim().toLowerCase())}`, 5, 86400);
    return this.svc.saveLead(d.offer_id, d.email.trim().toLowerCase(), d.name, d.phone);
  }

  /** Compra com 1 clique, passo 1: envia código ao e-mail do comprador com cartão guardado. */
  @Post('v1/public/one-click/start') @HttpCode(200)
  async oneClickStart(@Body() b: any, @Req() req: R) {
    const { email } = parse(z.object({ email: z.string().email().max(200) }), b);
    return this.svc.startOneClick(email, clientIp(req));
  }

  /** Passo 2: confere o código e devolve os cartões guardados (só bandeira e final). */
  @Post('v1/public/one-click/verify') @HttpCode(200)
  async oneClickVerify(@Body() b: any, @Req() req: R) {
    const d = parse(z.object({ email: z.string().email().max(200), code: z.string().regex(/^\d{6}$/, 'Digite os 6 números.') }), b);
    return this.svc.verifyOneClick(d.email, d.code, clientIp(req));
  }

  /** Token para o navegador iniciar a autenticação 3-D Secure (a chave secreta fica no servidor). */
  @Post('v1/public/3ds-token') @HttpCode(200)
  async threeDSToken(@Req() req: R) {
    if (!this.gateway.threeDSToken || !this.gateway.publicConfig().threeDS) throw new AppError('NOT_FOUND');
    await rl.limit(`3ds:${hashIp(clientIp(req))}`, 30, 600);
    try { return { token: await this.gateway.threeDSToken() }; }
    catch { throw new AppError('INTERNAL_ERROR', { title: 'Não conseguimos falar com o banco. Tente de novo.' }); }
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
  async thanks(@Param('id') id: string, @Query('t') t: string, @Req() req: R) {
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
    // Entrar direto da página de obrigado só no primeiro pedido do e-mail (cadastro criado por esta compra).
    // Comprador que já existia entra pelo link mágico do e-mail: quem pagou não necessariamente é o dono da conta.
    let login_token: string | null = null;
    const earlier = o.status === 'paid' ? await this.prisma.orders.count({ where: { customer_id: o.customer_id, created_at: { lt: o.created_at } } }) : 1;
    if (o.status === 'paid' && earlier === 0 && customer.created_at >= new Date(o.created_at.getTime() - 60_000)) {
      login_token = randomToken(32);
      await this.prisma.customer_auth_tokens.create({ data: { customer_id: o.customer_id, kind: 'order', token_hash: sha256(login_token), expires_at: new Date(Date.now() + 15 * 60_000) } });
    }
    const offer = await this.prisma.offers.findUniqueOrThrow({ where: { id: o.offer_id } });
    const p = o.payments[0];
    // no domínio próprio do produtor, o login acontece no endereço principal (a sessão não pode nascer lá)
    const onCustomDomain = !!requestHost(req);
    const dest = main.type === 'course' || main.type === 'subscription' ? `/curso/${main.id}` : '/minhas-compras';
    const login_url = login_token && onCustomDomain ? `${process.env.APP_URL || ''}/minhas-compras/entrar?ot=${login_token}&volta=${encodeURIComponent(dest)}` : null;
    return toJSON({
      order_id: o.id, code: o.code, status: o.status, method: o.method, total_cents: o.total_cents, installments: o.installments,
      email: customer.email, product: { id: main.id, name: main.name, type: main.type, service_url: main.service_url },
      items: o.items.map(i => ({ name: products.find(p => p.id === i.product_id)?.name, kind: i.kind, price_cents: i.price_cents })),
      boleto: o.method === 'boleto' ? { line: p?.boleto_line, url: p?.boleto_url, due_at: p?.boleto_due_at } : null,
      thank_you_url: offer.thank_you_url, fire_purchase, login_token: onCustomDomain ? null : login_token, login_url, access_by_email: o.status === 'paid' && !login_token,
      sandbox: this.gateway.name === 'sandbox' && o.status === 'pending' ? { charge_id: p?.provider_charge_id } : null,
    });
  }

  /** Upsell/downsell com 1 clique na página de obrigado (Fase 2). */
  @Get('v1/orders/:id/upsell')
  async upsell(@Param('id') id: string, @Query('t') t: string) {
    orderFromToken(id, t);
    return toJSON(await this.funnel.state(id));
  }

  @Post('v1/orders/:id/upsell') @HttpCode(200)
  async upsellDecide(@Param('id') id: string, @Query('t') t: string, @Body() b: any, @Req() req: R) {
    orderFromToken(id, t);
    const d = parse(z.object({ step: z.enum(['upsell', 'downsell']), accept: z.boolean(), method: z.enum(['card', 'pix']).optional(), installments: z.number().int().min(1).max(12).optional() }), b);
    await rl.limit(`funnel:${id}`, 10, 600);
    return toJSON(await this.funnel.decide(id, d, { ip: clientIp(req), ua: String(req.headers['user-agent'] || '') }));
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
