import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { Admin, Ctx, ProducerCtx, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { hashIp } from '../../common/crypto';
import { toJSON } from '../../http/json';

const MAX_ADJUST = 10_000_000n; // R$ 100.000,00 por ajuste

/**
 * Ajustes manuais de saldo (RN-38): o saldo nunca é editado; um ajuste vira lançamentos no ledger
 * com motivo, depois de pedido por uma pessoa do Financeiro Domma e aprovado por OUTRA.
 * A contrapartida é a conta da plataforma, então débitos = créditos.
 */
@Controller('v1/admin/adjustments')
export class AdjustmentsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private ledger: LedgerService) {}

  @Get() @Admin('ledger.adjust')
  async list(@Query('status') status = 'pending') {
    const rows = await this.prisma.ledger_adjustments.findMany({ where: status === 'all' ? {} : { status }, orderBy: { created_at: 'desc' }, take: 200 });
    const ws = await this.prisma.workspaces.findMany({ where: { id: { in: rows.map(r => r.workspace_id) } } });
    const users = await this.prisma.users.findMany({ where: { id: { in: rows.flatMap(r => [r.requested_by, r.decided_by]).filter(Boolean) as string[] } } });
    const name = (id: string | null) => (id ? users.find(u => u.id === id)?.name ?? '—' : null);
    return toJSON(rows.map(r => ({ ...r, account: ws.find(w => w.id === r.workspace_id)?.name, requested_by_name: name(r.requested_by), decided_by_name: name(r.decided_by) })));
  }

  @Post() @Admin('ledger.adjust')
  async request(@Ctx() c: ProducerCtx, @Body() b: any, @Req() req: R) {
    const d = parse(z.object({ workspace_id: z.string().uuid(), amount_cents: z.number().int().refine(v => v !== 0, 'O valor não pode ser zero.'), reason: z.string().min(15, 'Explique o motivo (mín. 15 caracteres).').max(1000) }), b);
    if (BigInt(Math.abs(d.amount_cents)) > MAX_ADJUST) throw new AppError('VALIDATION_ERROR', { fields: { amount_cents: 'Ajuste máximo de R$ 100.000,00. Divida ou use o processo de exceção.' } });
    const ws = await this.prisma.workspaces.findUnique({ where: { id: d.workspace_id } });
    if (!ws) throw new AppError('NOT_FOUND');
    const a = await this.prisma.ledger_adjustments.create({ data: { workspace_id: ws.id, amount_cents: BigInt(d.amount_cents), reason: d.reason, requested_by: c.userId } });
    await this.audit.log({ actorId: c.userId, action: 'ledger_adjustment.request', target: `workspace:${ws.id}`, after: { adjustment: a.id, amount_cents: d.amount_cents }, reason: d.reason, ipHash: hashIp(clientIp(req)) });
    return toJSON(a);
  }

  @Post(':id/approve') @Admin('ledger.adjust') @HttpCode(200)
  async approve(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any, @Req() req: R) {
    const { note } = parse(z.object({ note: z.string().max(500).optional() }), b ?? {});
    const result = await this.prisma.$transaction(async (tx) => {
      const [a] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ledger_adjustments WHERE id = ${id}::uuid FOR UPDATE`;
      if (!a) throw new AppError('NOT_FOUND');
      const adj = await tx.ledger_adjustments.findUniqueOrThrow({ where: { id } });
      if (adj.status !== 'pending') throw new AppError('VALIDATION_ERROR', { title: 'Este ajuste já foi decidido.' });
      if (adj.requested_by === c.userId) throw new AppError('PERMISSION_DENIED', { title: 'Outra pessoa do Financeiro precisa aprovar este ajuste.' });
      const amt = adj.amount_cents > 0n ? adj.amount_cents : -adj.amount_cents;
      const credit = adj.amount_cents > 0n;
      const desc = `Ajuste manual: ${adj.reason.slice(0, 120)}`;
      const txId = await this.ledger.post(tx, { type: 'adjustment', id: adj.id }, [
        { owner_type: 'workspace', owner_id: adj.workspace_id, bucket: 'balance', ...(credit ? { credit: amt } : { debit: amt }), description: desc },
        { owner_type: 'platform', owner_id: null, bucket: 'balance', ...(credit ? { debit: amt } : { credit: amt }), description: `${desc} (conta ${adj.workspace_id.slice(0, 8)})` },
      ], c.userId);
      const updated = await tx.ledger_adjustments.update({ where: { id }, data: { status: 'approved', decided_by: c.userId, decided_at: new Date(), decision_note: note, transaction_id: txId } });
      await this.audit.log({ actorId: c.userId, action: 'ledger_adjustment.approve', target: `workspace:${adj.workspace_id}`, before: { status: 'pending' }, after: { adjustment: id, amount_cents: adj.amount_cents.toString(), transaction_id: txId, requested_by: adj.requested_by }, reason: note ?? adj.reason, ipHash: hashIp(clientIp(req)) }, tx);
      return updated;
    });
    return toJSON(result);
  }

  @Post(':id/reject') @Admin('ledger.adjust') @HttpCode(200)
  async reject(@Ctx() c: ProducerCtx, @Param('id') id: string, @Body() b: any) {
    const { note } = parse(z.object({ note: z.string().min(10, 'Explique o motivo (mín. 10 caracteres).').max(500) }), b ?? {});
    return this.decide(c, id, 'rejected', note);
  }

  @Post(':id/cancel') @Admin('ledger.adjust') @HttpCode(200)
  async cancel(@Ctx() c: ProducerCtx, @Param('id') id: string) {
    const adj = await this.prisma.ledger_adjustments.findUnique({ where: { id } });
    if (!adj) throw new AppError('NOT_FOUND');
    if (adj.requested_by !== c.userId) throw new AppError('PERMISSION_DENIED', { title: 'Só quem pediu pode cancelar.' });
    return this.decide(c, id, 'cancelled', 'Cancelado por quem pediu');
  }

  private async decide(c: ProducerCtx, id: string, status: 'rejected' | 'cancelled', note: string) {
    const adj = await this.prisma.ledger_adjustments.findUnique({ where: { id } });
    if (!adj) throw new AppError('NOT_FOUND');
    if (status === 'rejected' && adj.requested_by === c.userId) throw new AppError('PERMISSION_DENIED', { title: 'Outra pessoa do Financeiro precisa decidir este ajuste.' });
    const r = await this.prisma.ledger_adjustments.updateMany({ where: { id, status: 'pending' }, data: { status, ...(status === 'rejected' ? { decided_by: c.userId } : {}), decided_at: new Date(), decision_note: note } });
    if (!r.count) throw new AppError('VALIDATION_ERROR', { title: 'Este ajuste já foi decidido.' });
    await this.audit.log({ actorId: c.userId, action: `ledger_adjustment.${status === 'rejected' ? 'reject' : 'cancel'}`, target: `workspace:${adj.workspace_id}`, after: { adjustment: id }, reason: note });
    return { ok: true, status };
  }
}
