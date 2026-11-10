import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from './prisma.service';
import { sha256 } from '../common/crypto';

/** Trilha de auditoria imutável com hash encadeado (seções 5.10, 11.7). */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(e: { actorId?: string | null; action: string; target: string; before?: unknown; after?: unknown; ipHash?: string | null; reason?: string | null }, tx?: Tx) {
    const db = tx ?? this.prisma;
    // serializa a cadeia: lock transacional global da auditoria
    const run = async (t: Tx) => {
      await t.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(777001)`);
      const last = await t.audit_logs.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
      const prev = last?.hash ?? 'GENESIS';
      const created_at = new Date();
      const body = JSON.stringify({ a: e.actorId ?? null, ac: e.action, t: e.target, b: e.before ?? null, af: e.after ?? null, r: e.reason ?? null, at: created_at.toISOString() }, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
      const hash = sha256(prev + body);
      const json = (v: unknown) => v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x));
      await t.audit_logs.create({ data: { actor_id: e.actorId ?? null, action: e.action, target: e.target, before: json(e.before) as any, after: json(e.after) as any, ip_hash: e.ipHash ?? null, reason: e.reason ?? null, prev_hash: prev, hash, created_at } });
    };
    if (tx) return run(tx);
    return (db as PrismaService).$transaction(run);
  }

  /** Verifica a integridade da cadeia (usado no back-office). */
  async verifyChain(): Promise<{ ok: boolean; brokenAt?: string; count: number }> {
    const rows = await this.prisma.audit_logs.findMany({ orderBy: { seq: 'asc' } });
    let prev = 'GENESIS';
    for (const r of rows) {
      const body = JSON.stringify({ a: r.actor_id, ac: r.action, t: r.target, b: r.before ?? null, af: r.after ?? null, r: r.reason, at: r.created_at.toISOString() });
      if (r.prev_hash !== prev || sha256(prev + body) !== r.hash) return { ok: false, brokenAt: r.id, count: rows.length };
      prev = r.hash;
    }
    return { ok: true, count: rows.length };
  }
}
