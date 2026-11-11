import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../infra/audit.service';
import { PrismaService, Tx } from '../../infra/prisma.service';
import { redis } from '../../infra/redis';
import * as rl from '../../infra/rate-limit';
import { blindIndex } from '../../common/crypto';
import { DEFAULT_RISK, RiskConfig, Signal, Decision, mergeConfig, scoreRules, gatewaySignal, total, decide, hourBRT } from '../../domain/risk';

export type CardAttempt = {
  workspaceId: string; offerId: string; amountCents: bigint;
  docHash: string; email: string; ipHash: string; device?: string; bin?: string; ipCountry?: string;
  /** 3-D Secure já autenticado pelo banco (Y = autenticado, A = tentativa aceita). */
  threeDSOk: boolean;
};
export type Assessment = { score: number; decision: Decision; signals: Signal[]; hold: boolean };

/** Chave do aparelho e do BIN na lista de bloqueio (mesmo formato do back-office). */
export const deviceKey = (d: string) => blindIndex(`device:${d}`);
export const binKey = (b: string) => blindIndex(`bin:${b}`);

/**
 * Antifraude (RN-60): mede a tentativa (velocidade, aparelho, país, comprador novo...), soma os pontos das regras
 * e decide a faixa. Depois da cobrança, soma a pontuação do gateway. Faixa "revisar" não recusa a compra:
 * o comprador recebe o produto e o dinheiro do produtor fica "Em análise" até a equipe de Risco decidir.
 */
@Injectable()
export class RiskService {
  private log = new Logger('Risk');
  private cache: { at: number; cfg: RiskConfig } | null = null;
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async config(): Promise<RiskConfig> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.cfg;
    const row = await this.prisma.risk_config.findUnique({ where: { key: 'config' } }).catch(() => null);
    const cfg = mergeConfig(row?.value as any);
    this.cache = { at: Date.now(), cfg };
    return cfg;
  }
  invalidate() { this.cache = null; }

  /** Antes da cobrança no cartão: pontuação das regras e a faixa. Recusa não cria pedido (o chamador recusa). */
  async assessCard(a: CardAttempt): Promise<Assessment> {
    const cfg = await this.config();
    const r = cfg.rules;
    const win = (k: keyof typeof r) => Math.max(1, r[k].window_min ?? 60) * 60;
    const [cpf, ip, device] = await Promise.all([
      rl.hit(`ra:cpf:${a.docHash}`, win('velocity_cpf')),
      rl.hit(`ra:ip:${a.ipHash}`, win('velocity_ip')),
      a.device ? rl.hit(`ra:dev:${blindIndex(a.device)}`, win('velocity_device')) : Promise.resolve(0),
    ]);
    // CPFs diferentes no mesmo aparelho (ou IP, sem aparelho)
    const idKey = a.device ? `ri:dev:${blindIndex(a.device)}` : `ri:ip:${a.ipHash}`;
    await redis().sadd(idKey, a.docHash);
    await redis().expire(idKey, win('identities_device'));
    const identities = await redis().scard(idKey);
    const recentDeclines = Math.max(await rl.count(`decl:cpf:${a.docHash}`), await rl.count(`decl:ip:${a.ipHash}`));
    const blocked = await this.prisma.blocklist.findMany({
      where: { OR: [...(a.device ? [{ kind: 'device', value_hash: deviceKey(a.device) }] : []), ...(a.bin ? [{ kind: 'bin', value_hash: binKey(a.bin) }] : [])], AND: [{ OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] }] },
    });
    const cu = await this.prisma.customers.findUnique({ where: { email: a.email }, select: { id: true } });
    const paidBefore = cu ? await this.prisma.orders.count({ where: { customer_id: cu.id, paid_at: { not: null } } }) : 0;
    const signals = scoreRules({
      amountCents: a.amountCents, attempts: { cpf, ip, device }, identitiesOnDevice: identities, recentDeclines,
      ipCountry: a.ipCountry, firstPurchase: paidBefore === 0, hasDevice: !!a.device,
      blockedDevice: blocked.some(b => b.kind === 'device'), blockedBin: blocked.some(b => b.kind === 'bin'), hourBRT: hourBRT(),
    }, cfg);
    return this.finish(signals, cfg, a.threeDSOk);
  }

  /** Faixa final: 3-D Secure autenticado cobre a faixa 3DS; sem ele, a compra vai para revisão. */
  private finish(signals: Signal[], cfg: RiskConfig, threeDSOk: boolean): Assessment {
    const score = total(signals);
    const decision = decide(score, cfg.bands);
    const hold = decision === 'review' || (decision === 'three_ds' && !threeDSOk);
    return { score, decision, signals, hold };
  }

  /** Grava a avaliação (com ou sem pedido). Revisão abre item na fila. */
  async record(a: CardAttempt, r: Assessment, orderId?: string) {
    return this.prisma.risk_assessments.create({
      data: {
        order_id: orderId, workspace_id: a.workspaceId, offer_id: a.offerId, method: 'card', amount_cents: a.amountCents,
        score: r.score, decision: r.decision, signals: r.signals as any, doc_hash: a.docHash, email_hash: blindIndex(a.email), ip_hash: a.ipHash,
        device: a.device ? blindIndex(a.device) : null, review_status: r.hold ? 'open' : null,
      },
    });
  }

  /** Depois da cobrança: soma a pontuação do gateway. Se passar a faixa de revisão, abre a revisão. Devolve se abriu agora. */
  async afterCharge(tx: Tx, assessmentId: string, gatewayScore: number | undefined, threeDSOk: boolean) {
    const cfg = await this.config();
    const cur = await tx.risk_assessments.findUnique({ where: { id: assessmentId } });
    if (!cur) return false;
    const g = gatewaySignal(gatewayScore, cfg);
    const signals = [...(cur.signals as Signal[]), ...(g ? [g] : [])];
    const r = this.finish(signals, cfg, threeDSOk);
    const opened = r.hold && cur.review_status == null;
    await tx.risk_assessments.update({
      where: { id: assessmentId },
      data: { gateway_score: gatewayScore ?? null, score: r.score, decision: r.decision, signals: signals as any, ...(opened ? { review_status: 'open' } : {}) },
    });
    return opened;
  }

  /** O pedido tem revisão aberta? (o dinheiro do produtor fica "Em análise") */
  async isUnderReview(orderId: string) {
    return (await this.prisma.risk_assessments.count({ where: { order_id: orderId, review_status: 'open' } })) > 0;
  }

  /** Alerta para a equipe de Risco (com chave para não repetir o mesmo alerta). */
  async alert(a: { kind: string; level: 'info' | 'warn' | 'high'; message: string; workspaceId?: string; offerId?: string; data?: any; dedupe?: string }) {
    try {
      await this.prisma.risk_alerts.create({ data: { kind: a.kind, level: a.level, message: a.message, workspace_id: a.workspaceId, offer_id: a.offerId, data: a.data, dedupe_key: a.dedupe } });
      this.log.warn(`alerta de risco: ${a.message}`);
    } catch (e: any) { if (e?.code !== 'P2002') throw e; }
  }

  /** Chargeback e reembolso por conta nos últimos 30 dias (RN-55). */
  async producerRates() {
    const cfg = await this.config();
    const rows = await this.prisma.$queryRaw<{ workspace_id: string; name: string; paid: number; cb: number; refunds: number; paused: boolean }[]>(Prisma.sql`
      SELECT o.workspace_id, w.name, w.payouts_paused_at IS NOT NULL paused, COUNT(*) FILTER (WHERE o.paid_at IS NOT NULL)::int paid,
        COUNT(*) FILTER (WHERE o.status IN ('chargeback','chargeback_lost','chargeback_won'))::int cb,
        COUNT(*) FILTER (WHERE o.status='refunded')::int refunds
      FROM orders o JOIN workspaces w ON w.id=o.workspace_id WHERE o.created_at > now() - interval '30 days' GROUP BY 1,2,3`);
    const p = cfg.producer;
    return rows.map(r => {
      const rate = r.paid ? (r.cb / r.paid) * 100 : 0;
      const enough = r.paid >= p.min_orders;
      const level = !enough ? 'ok' : rate >= p.pause_pct ? 'pausa' : rate >= p.review_pct ? 'revisão' : rate >= p.alert_pct ? 'alerta' : 'ok';
      return { ...r, chargeback_pct: Math.round(rate * 100) / 100, refund_pct: r.paid ? Math.round((r.refunds / r.paid) * 10000) / 100 : 0, level, enough_orders: enough };
    }).sort((a, b) => b.chargeback_pct - a.chargeback_pct);
  }

  /**
   * Rotina diária (RN-55): alerta em 1%, revisão em 1,5% e, em 2%, pausa cautelar dos saques
   * (as vendas continuam; a equipe de Risco decide se bloqueia a conta). Só com volume mínimo de vendas.
   */
  async scanProducers() {
    const month = new Date().toISOString().slice(0, 7);
    let paused = 0;
    for (const r of await this.producerRates()) {
      if (r.level === 'ok') continue;
      const lvl = r.level === 'pausa' ? 'high' : r.level === 'revisão' ? 'warn' : 'info';
      await this.alert({ kind: 'producer_chargeback', level: lvl, workspaceId: r.workspace_id, data: r, dedupe: `producer_cb:${r.workspace_id}:${r.level}:${month}`,
        message: `${r.name}: ${r.chargeback_pct}% de chargeback em 30 dias (${r.cb} de ${r.paid} vendas) — ${r.level === 'pausa' ? 'saques pausados' : r.level}.` });
      if (r.level === 'pausa' && !r.paused) {
        const reason = `Pausa automática: ${r.chargeback_pct}% de chargeback em 30 dias (limite ${(await this.config()).producer.pause_pct}%).`;
        await this.prisma.workspaces.update({ where: { id: r.workspace_id }, data: { payouts_paused_at: new Date(), payouts_paused_reason: reason } });
        await this.audit.log({ action: 'account.payouts_paused', target: `workspace:${r.workspace_id}`, reason });
        paused++;
      }
    }
    return { paused };
  }

  static defaults() { return DEFAULT_RISK; }
}
