import { Controller, HttpCode, Inject, Logger, Param, Post, Req, Get, Res, Body } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue.service';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { Public, Req as R } from '../../http/context';
import { SandboxGateway } from '../gateway/sandbox.adapter';
import { AppError } from '../../common/errors';
import { verifyToken } from '../../common/crypto';

/** Entrada de eventos do gateway (22.6): valida assinatura, grava, responde 200 em < 2 s, processa na fila. */
@Controller()
@Public()
export class WebhooksController {
  private log = new Logger('WebhookIn');
  constructor(private prisma: PrismaService, private queue: QueueService, @Inject(GATEWAY) private gateway: GatewayAdapter) {}

  @Post('webhooks/:provider') @HttpCode(200)
  async receive(@Param('provider') provider: string, @Req() req: R) {
    if (provider !== this.gateway.name) throw new AppError('NOT_FOUND');
    let ev;
    try { ev = this.gateway.parseWebhook(req.headers, req.rawBody ?? Buffer.from('')); }
    catch (e) { this.log.warn(`assinatura inválida: ${(e as Error).message}`); throw new AppError('PERMISSION_DENIED'); }
    try {
      const row = await this.prisma.webhook_events_in.create({ data: { provider, event_id: ev.eventId, type: ev.type, payload: ev as any } });
      await this.queue.add('webhook.in', { id: row.id });
    } catch (e: any) {
      if (e.code === 'P2002') return { ok: true, duplicate: true }; // RN-31: evento repetido não reprocessa
      throw e;
    }
    return { ok: true };
  }
}

/** Ferramentas do sandbox — só existem com GATEWAY_PROVIDER=sandbox fora de produção. */
@Controller('v1/dev/sandbox')
@Public()
export class SandboxController {
  constructor(private prisma: PrismaService, @Inject(GATEWAY) private gateway: GatewayAdapter) {}
  private guard() {
    if (!(this.gateway instanceof SandboxGateway) || process.env.NODE_ENV === 'production') throw new AppError('NOT_FOUND');
    return this.gateway;
  }

  /** Simula o pagamento de um Pix/boleto. Exige o token do pedido (quem está na tela). */
  @Post('orders/:id/pay') @HttpCode(200)
  async pay(@Param('id') id: string, @Body() b: { t?: string }) {
    const gw = this.guard();
    const p = verifyToken<{ o: string }>(b?.t);
    if (!p || p.o !== id) throw new AppError('AUTH_LINK_EXPIRED');
    const pay = await this.prisma.payments.findFirst({ where: { order_id: id }, orderBy: { created_at: 'desc' } });
    if (!pay) throw new AppError('NOT_FOUND');
    try { await gw.emit({ type: 'charge.paid', chargeId: pay.provider_charge_id }); }
    catch (e) { throw new AppError('PIX_EXPIRED'); }
    return { ok: true };
  }

  @Get('boleto/:charge')
  boleto(@Param('charge') charge: string, @Res() res: Response) {
    this.guard();
    res.type('text/plain').send(`BOLETO DE TESTE (sandbox)\nCobrança: ${charge.replace('.pdf', '')}\nEste documento não tem valor.`);
  }
}
