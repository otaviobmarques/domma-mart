import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrivacyService } from './privacy.service';
import { Producer, Customer, Admin, Ctx, Cust, ProducerCtx, CustomerCtx, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { hashIp } from '../../common/crypto';
import { toJSON } from '../../http/json';
import * as rl from '../../infra/rate-limit';

const Request = z.object({ kind: z.enum(['deletion', 'correction', 'other']), details: z.string().max(2000).optional() });

function sendJson(res: Response, name: string, data: unknown) {
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
  res.send(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

/** Portal de direitos do titular (LGPD art. 18): baixar os dados e pedir exclusão ou correção. */
@Controller()
export class PrivacyController {
  constructor(private svc: PrivacyService) {}

  // comprador (Minhas compras)
  @Get('v1/customer/privacy/export') @Customer()
  async customerExport(@Cust() cu: CustomerCtx, @Res() res: Response) {
    await rl.limit(`privacy:export:c:${cu.customerId}`, 10, 3600);
    sendJson(res, 'meus-dados-domma-mart.json', await this.svc.exportCustomer(cu.customerId));
  }
  @Get('v1/customer/privacy/requests') @Customer()
  async customerRequests(@Cust() cu: CustomerCtx) { return toJSON(await this.svc.myRequests({ type: 'customer', id: cu.customerId })); }
  @Post('v1/customer/privacy/requests') @Customer() @HttpCode(201)
  async customerRequest(@Cust() cu: CustomerCtx, @Body() b: any, @Req() req: R) {
    const d = parse(Request, b);
    return toJSON(await this.svc.request({ type: 'customer', id: cu.customerId }, d.kind, d.details, hashIp(clientIp(req))));
  }

  // produtor, afiliado, coprodutor (painel)
  @Get('v1/privacy/export') @Producer()
  async userExport(@Ctx() c: ProducerCtx, @Res() res: Response) {
    await rl.limit(`privacy:export:u:${c.userId}`, 10, 3600);
    sendJson(res, 'meus-dados-domma-mart.json', await this.svc.exportUser(c.userId));
  }
  @Get('v1/privacy/requests') @Producer()
  async userRequests(@Ctx() c: ProducerCtx) { return toJSON(await this.svc.myRequests({ type: 'user', id: c.userId })); }
  @Post('v1/privacy/requests') @Producer() @HttpCode(201)
  async userRequest(@Ctx() c: ProducerCtx, @Body() b: any, @Req() req: R) {
    const d = parse(Request, b);
    return toJSON(await this.svc.request({ type: 'user', id: c.userId }, d.kind, d.details, hashIp(clientIp(req))));
  }

  // back-office
  @Get('v1/admin/privacy') @Admin('privacy.manage')
  async queue(@Query('status') status = 'pending') { return toJSON(await this.svc.queue(status)); }
  @Post('v1/admin/privacy/:id/decision') @Admin('privacy.manage') @HttpCode(200)
  async decide(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any, @Req() req: R) {
    const d = parse(z.object({ decision: z.enum(['done', 'rejected']), resolution: z.string().min(10, 'Explique a resposta ao titular (mín. 10 caracteres).').max(1000) }), b);
    return toJSON(await this.svc.decide(id, c.userId, d, hashIp(clientIp(req))));
  }
}
