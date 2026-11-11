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

  /**
   * Antifraude: segura em "Em análise" os créditos de produtor, afiliado e sócios de um pedido em revisão.
   * Idempotente (só segura o que ainda não está seguro). Cada parcela volta depois na mesma data de liberação.
   */
  async holdOrder(tx: Tx, orderId: string, code: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'hold:' + orderId}))`;
    const already = await tx.ledger_entries.count({ where: { reference_type: 'risk_hold', reference_id: orderId } });
    if (already) return false;
    const credits = await tx.ledger_entries.findMany({ where: { reference_type: 'order', reference_id: orderId, owner_type: 'workspace', bucket: 'balance', credit_cents: { gt: 0 } } });
    const entries: Entry[] = [];
    for (const c of credits) {
      entries.push({ owner_type: 'workspace', owner_id: c.owner_id, bucket: 'balance', debit: c.credit_cents, available_at: c.available_at, description: `Em análise de segurança — ${code}` });
      entries.push({ owner_type: 'workspace', owner_id: c.owner_id, bucket: 'blocked', credit: c.credit_cents, available_at: c.available_at, description: `Em análise de segurança — ${code}` });
    }
    if (!entries.length) return false;
    await this.post(tx, { type: 'risk_hold', id: orderId }, entries);
    return true;
  }

  /** Devolve ao saldo o que holdOrder segurou (aprovação da análise, ou antes de um reembolso/contestação). */
  async releaseOrderHold(tx: Tx, orderId: string, code: string, description = `Análise de segurança concluída — ${code}`) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'hold:' + orderId}))`;
    const rows = await tx.ledger_entries.findMany({ where: { reference_type: 'risk_hold', reference_id: orderId, bucket: 'blocked' } });
    // agrupa por beneficiário + data: o que ainda está seguro (crédito − débito)
    const net = new Map<string, { owner_id: string | null; at: Date; amount: bigint }>();
    for (const r of rows) {
      const k = `${r.owner_id}|${r.available_at.toISOString()}`;
      const cur = net.get(k) ?? { owner_id: r.owner_id, at: r.available_at, amount: 0n };
      cur.amount += r.credit_cents - r.debit_cents;
      net.set(k, cur);
    }
    const entries: Entry[] = [];
    for (const v of net.values()) {
      if (v.amount <= 0n) continue;
      entries.push({ owner_type: 'workspace', owner_id: v.owner_id, bucket: 'blocked', debit: v.amount, available_at: v.at, description });
      entries.push({ owner_type: 'workspace', owner_id: v.owner_id, bucket: 'balance', credit: v.amount, available_at: v.at, description });
    }
    if (entries.length) await this.post(tx, { type: 'risk_hold', id: orderId }, entries);
    return entries.length > 0;
  }

  async movements(workspaceId: string, opts: { from?: Date; to?: Date; cursor?: string; limit?: number }) {
    return this.prisma.ledger_entries.findMany({
      where: { owner_type: 'workspace', owner_id: workspaceId, created_at: { gte: opts.from, lte: opts.to }, ...(opts.cursor ? { id: { lt: opts.cursor } } : {}) },
      orderBy: { id: 'desc' }, take: Math.min(opts.limit ?? 50, 500),
    });
  }
}
