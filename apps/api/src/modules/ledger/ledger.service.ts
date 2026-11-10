import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../infra/prisma.service';
import { randomUUID } from 'node:crypto';

export interface Entry {
  owner_type: 'workspace' | 'platform' | 'gateway';
  owner_id: string | null;
  bucket: 'balance' | 'blocked' | 'clearing';
  debit?: bigint;
  credit?: bigint;
  available_at?: Date;
  description: string;
}

/**
 * Livro-razão de dupla entrada, somente inserção (seção 5.4, RN-38, tabela 21.6).
 * Saldo = soma dos lançamentos; nunca um campo editável.
 *   balance com available_at ≤ agora → "Você pode sacar agora"
 *   balance com available_at > agora → "Chegando"
 *   blocked                          → "Em análise"
 */
@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  async post(tx: Tx, ref: { type: string; id: string }, entries: Entry[], createdBy?: string) {
    const d = entries.reduce((s, e) => s + (e.debit ?? 0n), 0n);
    const c = entries.reduce((s, e) => s + (e.credit ?? 0n), 0n);
    if (d !== c) throw new Error(`ledger desbalanceado: débitos ${d} ≠ créditos ${c}`);
    const transaction_id = randomUUID();
    const now = new Date();
    const rows = entries.filter(e => (e.debit ?? 0n) > 0n || (e.credit ?? 0n) > 0n).map(e => ({
      transaction_id, owner_type: e.owner_type, owner_id: e.owner_id, bucket: e.bucket,
      debit_cents: e.debit ?? 0n, credit_cents: e.credit ?? 0n, reference_type: ref.type, reference_id: ref.id,
      available_at: e.available_at ?? now, description: e.description, created_by: createdBy ?? null,
    }));
    if (rows.length) await tx.ledger_entries.createMany({ data: rows });
    return transaction_id;
  }

  async balance(workspaceId: string, db: Tx | PrismaService = this.prisma) {
    const [r] = await db.$queryRaw<{ available: bigint; incoming: bigint; blocked: bigint }[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN bucket='balance' AND available_at <= now() THEN credit_cents - debit_cents END),0)::bigint AS available,
        COALESCE(SUM(CASE WHEN bucket='balance' AND available_at >  now() THEN credit_cents - debit_cents END),0)::bigint AS incoming,
        COALESCE(SUM(CASE WHEN bucket='blocked' THEN credit_cents - debit_cents END),0)::bigint AS blocked
      FROM ledger_entries WHERE owner_type='workspace' AND owner_id=${workspaceId}::uuid`);
    const [bc] = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n FROM (
        SELECT reference_id FROM ledger_entries WHERE owner_type='workspace' AND owner_id=${workspaceId}::uuid AND bucket='blocked'
        GROUP BY reference_id HAVING SUM(credit_cents-debit_cents) > 0) x`);
    const available = r.available;
    return {
      available_cents: available > 0n ? available : 0n,
      negative_cents: available < 0n ? -available : 0n,
      incoming_cents: r.incoming,
      blocked_cents: r.blocked,
      blocked_count: Number(bc.n),
    };
  }

  /** Lista "Ver datas" do card Chegando. */
  async incomingByDate(workspaceId: string) {
    return this.prisma.$queryRaw<{ day: Date; amount: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', available_at AT TIME ZONE 'America/Sao_Paulo') AS day, SUM(credit_cents-debit_cents)::bigint AS amount
      FROM ledger_entries WHERE owner_type='workspace' AND owner_id=${workspaceId}::uuid AND bucket='balance' AND available_at > now()
      GROUP BY 1 HAVING SUM(credit_cents-debit_cents) <> 0 ORDER BY 1`);
  }

  /**
   * Reverte os créditos de um pedido. Parcelas ainda "Chegando" são canceladas na mesma data;
   * parcelas já liberadas saem do disponível agora (pode gerar saldo negativo — RN-39).
   */
  async reverseOrderCredits(tx: Tx, orderId: string, opts: { ref: { type: string; id: string }; owners: ('workspace' | 'platform')[]; toBlocked?: boolean; description: (e: { owner_type: string }) => string }) {
    const credits = await tx.ledger_entries.findMany({ where: { reference_type: 'order', reference_id: orderId, credit_cents: { gt: 0 }, bucket: 'balance', owner_type: { in: opts.owners } } });
    const now = new Date();
    const entries: Entry[] = [];
    let total = 0n;
    for (const c of credits) {
      const at = c.available_at > now ? c.available_at : now;
      entries.push({ owner_type: c.owner_type as any, owner_id: c.owner_id, bucket: 'balance', debit: c.credit_cents, available_at: at, description: opts.description(c) });
      if (opts.toBlocked) entries.push({ owner_type: c.owner_type as any, owner_id: c.owner_id, bucket: 'blocked', credit: c.credit_cents, description: opts.description(c) });
      total += c.credit_cents;
    }
    if (!opts.toBlocked && total > 0n) entries.push({ owner_type: 'gateway', owner_id: null, bucket: 'clearing', credit: total, description: 'Devolução ao comprador' });
    if (entries.length) await this.post(tx, opts.ref, entries);
    return credits;
  }

  async movements(workspaceId: string, opts: { from?: Date; to?: Date; cursor?: string; limit?: number }) {
    return this.prisma.ledger_entries.findMany({
      where: { owner_type: 'workspace', owner_id: workspaceId, created_at: { gte: opts.from, lte: opts.to }, ...(opts.cursor ? { id: { lt: opts.cursor } } : {}) },
      orderBy: { id: 'desc' }, take: Math.min(opts.limit ?? 50, 500),
    });
  }
}
