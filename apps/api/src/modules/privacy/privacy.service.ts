import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../../infra/audit.service';
import { NotifyService } from '../../infra/notify.service';
import { LedgerService } from '../ledger/ledger.service';
import { AppError } from '../../common/errors';
import { decrypt, encrypt, blindIndex } from '../../common/crypto';

/** Prazo de guarda legal (Lei 9.613/1998 para dados de identidade e operações; prazos fiscais e do CDC). */
const RETENTION_YEARS = 5;
const addYears = (d: Date, y: number) => { const x = new Date(d); x.setFullYear(x.getFullYear() + y); return x; };

/**
 * Portal de direitos do titular (LGPD art. 18, seção 12.1 do descritivo).
 * - Exportação: o titular baixa os próprios dados (acesso e portabilidade).
 * - Exclusão: comprador sem compras pagas é anonimizado na hora; com compras, o que não é obrigatório
 *   guardar sai na hora (cartões, leads, marketing) e o resto é anonimizado quando vence o prazo legal.
 *   Conta de produtor/afiliado passa pela equipe (saldo, saques e contestações precisam estar zerados).
 */
@Injectable()
export class PrivacyService {
  private log = new Logger('Privacy');
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotifyService, private ledger: LedgerService) {}

  // ───────── Exportação ─────────
  async exportCustomer(customerId: string) {
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: customerId } });
    const orders = await this.prisma.orders.findMany({ where: { customer_id: customerId }, include: { items: true }, orderBy: { created_at: 'desc' } });
    const productIds = [...new Set(orders.flatMap(o => o.items.map(i => i.product_id)))];
    const products = await this.prisma.products.findMany({ where: { id: { in: productIds } }, include: { workspace: true } });
    const pname = (id: string) => products.find(p => p.id === id);
    const [enrollments, subs, cards, requests, optEmail, optPhone] = await Promise.all([
      this.prisma.enrollments.findMany({ where: { customer_id: customerId } }),
      this.prisma.subscriptions.findMany({ where: { customer_id: customerId } }),
      this.prisma.saved_cards.findMany({ where: { customer_id: customerId } }),
      this.prisma.privacy_requests.findMany({ where: { subject_type: 'customer', subject_id: customerId }, orderBy: { created_at: 'desc' } }),
      this.prisma.opt_outs.findUnique({ where: { key_hash: blindIndex(c.email) } }),
      this.prisma.opt_outs.findUnique({ where: { key_hash: blindIndex(decrypt(c.phone_enc)) } }),
    ]);
    return {
      gerado_em: new Date(), plataforma: 'Domma Mart', titular: 'comprador',
      aviso: 'Dados das suas compras na Domma Mart. Para cada compra, o vendedor (produtor) é o controlador dos dados; a Domma Mart é operadora.',
      dados_pessoais: { nome: c.name, email: c.email, whatsapp: decrypt(c.phone_enc), documento: decrypt(c.document_enc), criado_em: c.created_at },
      compras: orders.map(o => ({
        codigo: o.code, situacao: o.status, forma_de_pagamento: o.method, parcelas: o.installments, total_centavos: o.total_cents,
        criada_em: o.created_at, paga_em: o.paid_at, reembolsada_em: o.refunded_at,
        itens: o.items.map(i => ({ produto: pname(i.product_id)?.name ?? null, vendedor: pname(i.product_id)?.workspace.name ?? null, valor_centavos: i.price_cents })),
      })),
      acessos: enrollments.map(e => ({ produto: pname(e.product_id)?.name ?? e.product_id, situacao: e.status, desde: e.created_at, expira_em: e.expires_at })),
      assinaturas: subs.map(s => ({ situacao: s.status, valor_centavos: s.price_cents, cartao: s.card_last4 ? `${s.card_brand} •••• ${s.card_last4}` : null, proxima_cobranca: s.next_charge_at })),
      cartoes_guardados: cards.map(k => ({ cartao: `${k.brand} •••• ${k.last4}`, guardado_em: k.created_at, removido_em: k.revoked_at })),
      comunicacoes: { recebe_mensagens: !optEmail && !optPhone },
      pedidos_de_privacidade: requests.map(r => ({ tipo: r.kind, situacao: r.status, criado_em: r.created_at, guardar_ate: r.retain_until, resposta: r.resolution })),
    };
  }

  async exportUser(userId: string) {
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: userId } });
    const memberships = await this.prisma.memberships.findMany({ where: { user_id: userId }, include: { workspace: true } });
    const owned = memberships.filter(m => m.role === 'owner').map(m => m.workspace);
    const wsIds = owned.map(w => w.id);
    const [kyc, payout, legal, products, withdrawals, requests, sessions] = await Promise.all([
      this.prisma.kyc_submissions.findMany({ where: { workspace_id: { in: wsIds } }, orderBy: { created_at: 'desc' } }),
      this.prisma.payout_accounts.findMany({ where: { workspace_id: { in: wsIds } } }),
      this.prisma.legal_acceptances.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' } }),
      this.prisma.products.findMany({ where: { workspace_id: { in: wsIds } }, select: { name: true, type: true, moderation_status: true, created_at: true } }),
      this.prisma.withdrawals.findMany({ where: { workspace_id: { in: wsIds } }, orderBy: { created_at: 'desc' } }),
      this.prisma.privacy_requests.findMany({ where: { subject_type: 'user', subject_id: userId }, orderBy: { created_at: 'desc' } }),
      this.prisma.sessions.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, take: 50 }),
    ]);
    return {
      gerado_em: new Date(), plataforma: 'Domma Mart', titular: 'usuário (produtor, afiliado ou coprodutor)',
      dados_pessoais: { nome: u.name, email: u.email, usuario: u.username, telefone: u.phone_enc ? decrypt(u.phone_enc) : null, login_google: !!u.google_sub, verificacao_em_duas_etapas: !!u.totp_enabled_at, criado_em: u.created_at },
      contas: memberships.map(m => ({ nome: m.workspace.name, papel: m.role, identidade: m.workspace.kyc_status, tipo: m.workspace.person_type })),
      verificacoes_de_identidade: kyc.map(k => ({
        enviada_em: k.created_at, situacao: k.status, nome: k.name, documento: decrypt(k.document_enc), nascimento: k.birth_date, socio: k.partner_name,
        dados_complementares: k.extra_enc ? JSON.parse(decrypt(k.extra_enc)) : null,
        arquivos_guardados: [k.doc_front_key && 'foto do documento (frente)', k.doc_back_key && 'foto do documento (verso)', k.selfie_key && 'selfie'].filter(Boolean),
      })),
      contas_de_saque: payout.map(p => ({ tipo: p.kind, destino: p.pix_key_mask, titular: p.holder_name, desde: p.created_at })),
      produtos: products,
      saques: withdrawals.map(w => ({ valor_centavos: w.amount_cents, destino: w.destination_mask, situacao: w.status, em: w.created_at })),
      aceites_de_termos: legal.map(l => ({ documento: l.document, versao: l.version, em: l.created_at })),
      acessos_recentes: sessions.map(s => ({ em: s.created_at, ultimo_uso: s.last_seen_at, navegador: s.user_agent, encerrado_em: s.revoked_at })),
      pedidos_de_privacidade: requests.map(r => ({ tipo: r.kind, situacao: r.status, criado_em: r.created_at, guardar_ate: r.retain_until, resposta: r.resolution })),
    };
  }

  // ───────── Pedidos do titular ─────────
  async request(subject: { type: 'customer' | 'user'; id: string }, kind: 'deletion' | 'correction' | 'other', details: string | undefined, ipHash: string) {
    const open = await this.prisma.privacy_requests.findFirst({ where: { subject_type: subject.type, subject_id: subject.id, kind, status: { in: ['pending', 'scheduled'] } } });
    if (open) return this.view(open);
    let r = await this.prisma.privacy_requests.create({ data: { subject_type: subject.type, subject_id: subject.id, kind, details: details?.slice(0, 2000) } });
    await this.audit.log({ actorId: subject.type === 'user' ? subject.id : null, action: `privacy.${kind}.request`, target: `${subject.type}:${subject.id}`, after: { request: r.id }, ipHash });
    if (kind === 'deletion' && subject.type === 'customer') r = await this.processCustomerDeletion(r.id);
    return this.view(r);
  }

  async myRequests(subject: { type: 'customer' | 'user'; id: string }) {
    const rows = await this.prisma.privacy_requests.findMany({ where: { subject_type: subject.type, subject_id: subject.id }, orderBy: { created_at: 'desc' }, take: 20 });
    return rows.map(r => this.view(r));
  }

  private view(r: { id: string; kind: string; status: string; created_at: Date; retain_until: Date | null; resolution: string | null }) {
    return { id: r.id, kind: r.kind, status: r.status, created_at: r.created_at, retain_until: r.retain_until, resolution: r.resolution };
  }

  /** Exclusão do comprador: apaga o que não precisa ser guardado; anonimiza agora ou no fim do prazo legal. */
  async processCustomerDeletion(requestId: string) {
    const r = await this.prisma.privacy_requests.findUniqueOrThrow({ where: { id: requestId } });
    const c = await this.prisma.customers.findUniqueOrThrow({ where: { id: r.subject_id } });
    const email = c.email, phone = decrypt(c.phone_enc);
    // sai na hora: cartões guardados, carrinhos abandonados e mensagens
    await this.prisma.saved_cards.updateMany({ where: { customer_id: c.id, revoked_at: null }, data: { revoked_at: new Date() } });
    await this.prisma.checkout_leads.deleteMany({ where: { email, converted_at: null } });
    for (const k of [email, phone].filter(Boolean)) await this.prisma.opt_outs.upsert({ where: { key_hash: blindIndex(k) }, create: { key_hash: blindIndex(k) }, update: {} });
    const last = await this.prisma.orders.findFirst({ where: { customer_id: c.id, paid_at: { not: null } }, orderBy: { paid_at: 'desc' } });
    const activeSub = await this.prisma.subscriptions.count({ where: { customer_id: c.id, status: { in: ['active', 'trialing', 'past_due'] } } });
    if (activeSub) await this.prisma.subscriptions.updateMany({ where: { customer_id: c.id, status: { in: ['active', 'trialing', 'past_due'] } }, data: { cancel_at_period_end: true } });
    if (!last) {
      await this.anonymizeCustomer(c.id);
      return this.prisma.privacy_requests.update({ where: { id: r.id }, data: { status: 'done', decided_at: new Date(), resolution: 'Seus dados foram apagados. Não havia compras pagas que a lei mande guardar.' } });
    }
    const until = addYears(last.paid_at!, RETENTION_YEARS);
    return this.prisma.privacy_requests.update({ where: { id: r.id }, data: {
      status: 'scheduled', retain_until: until,
      resolution: `Apagamos seus cartões guardados e paramos as mensagens. Os dados das suas compras ficam guardados até ${until.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, por obrigação legal (fiscal e de defesa do consumidor), e depois são anonimizados automaticamente.${activeSub ? ' Suas assinaturas foram programadas para encerrar no fim do período já pago.' : ''}`,
    } });
  }

  private async anonymizeCustomer(customerId: string) {
    const tag = `removido:${customerId}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.customers.update({ where: { id: customerId }, data: { name: 'Titular removido', email: `removido-${customerId}@anonimo.invalid`, document_enc: encrypt(''), document_hash: blindIndex(tag), phone_enc: encrypt(''), phone_hash: blindIndex(tag + ':tel'), marketing_consent: undefined } });
      await tx.saved_cards.updateMany({ where: { customer_id: customerId, revoked_at: null }, data: { revoked_at: new Date() } });
      await tx.customer_sessions.updateMany({ where: { customer_id: customerId, revoked_at: null }, data: { revoked_at: new Date() } });
      await tx.customer_auth_tokens.deleteMany({ where: { customer_id: customerId } });
    });
    await this.audit.log({ actorId: null, action: 'privacy.customer.anonymized', target: `customer:${customerId}` });
  }

  private async anonymizeUser(userId: string) {
    const memberships = await this.prisma.memberships.findMany({ where: { user_id: userId, role: 'owner' } });
    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({ where: { id: userId }, data: { name: 'Titular removido', email: `removido-${userId}@anonimo.invalid`, username: null, phone_enc: null, password_hash: null, google_sub: null, totp_secret_enc: null, totp_enabled_at: null, status: 'blocked' } });
      await tx.sessions.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
      for (const m of memberships) {
        await tx.kyc_submissions.updateMany({ where: { workspace_id: m.workspace_id }, data: { name: 'Titular removido', document_enc: encrypt(''), extra_enc: null, birth_date: null, partner_name: null, doc_front_key: null, doc_back_key: null, selfie_key: null } });
        await tx.payout_accounts.deleteMany({ where: { workspace_id: m.workspace_id } });
      }
    });
    await this.audit.log({ actorId: null, action: 'privacy.user.anonymized', target: `user:${userId}` });
  }

  /** Job diário: anonimiza quem pediu exclusão quando vence o prazo legal de guarda. */
  async runDue() {
    const due = await this.prisma.privacy_requests.findMany({ where: { kind: 'deletion', status: 'scheduled', retain_until: { lte: new Date() } }, take: 200 });
    for (const r of due) {
      try {
        if (r.subject_type === 'customer') await this.anonymizeCustomer(r.subject_id); else await this.anonymizeUser(r.subject_id);
        await this.prisma.privacy_requests.update({ where: { id: r.id }, data: { status: 'done', decided_at: new Date(), resolution: 'Prazo legal de guarda encerrado: dados anonimizados.' } });
      } catch (e) { this.log.error(`anonimização ${r.id}: ${(e as Error).message}`); }
    }
    return due.length;
  }

  // ───────── Back-office ─────────
  async queue(status: string) {
    const rows = await this.prisma.privacy_requests.findMany({ where: status === 'all' ? {} : { status }, orderBy: { created_at: 'asc' }, take: 200 });
    const users = await this.prisma.users.findMany({ where: { id: { in: rows.filter(r => r.subject_type === 'user').map(r => r.subject_id) } } });
    const custs = await this.prisma.customers.findMany({ where: { id: { in: rows.filter(r => r.subject_type === 'customer').map(r => r.subject_id) } } });
    return rows.map(r => {
      const who = r.subject_type === 'user' ? users.find(u => u.id === r.subject_id) : custs.find(c => c.id === r.subject_id);
      return { ...this.view(r), subject_type: r.subject_type, details: r.details, subject: who ? { name: who.name, email: who.email.replace(/^(.{2}).*(@.*)$/, '$1***$2') } : null };
    });
  }

  /**
   * Conclui um pedido. Exclusão de usuário: confere saldo e saques, encerra a conta (bloqueia acesso e
   * despublica produtos) e agenda a anonimização para o fim do prazo legal.
   */
  async decide(id: string, actorId: string, d: { decision: 'done' | 'rejected'; resolution: string }, ipHash: string) {
    const r = await this.prisma.privacy_requests.findUnique({ where: { id } });
    if (!r || !['pending', 'scheduled'].includes(r.status)) throw new AppError('NOT_FOUND');
    let data: any = { status: d.decision, resolution: d.resolution, decided_by: actorId, decided_at: new Date() };
    if (d.decision === 'done' && r.kind === 'deletion' && r.subject_type === 'user') {
      const owned = await this.prisma.memberships.findMany({ where: { user_id: r.subject_id, role: 'owner' } });
      for (const m of owned) {
        const b = await this.ledger.balance(m.workspace_id);
        const pendingWd = await this.prisma.withdrawals.count({ where: { workspace_id: m.workspace_id, status: { in: ['requested', 'processing'] } } });
        if (b.available_cents > 0n || b.incoming_cents > 0n || b.blocked_cents > 0n || b.negative_cents > 0n || pendingWd) throw new AppError('VALIDATION_ERROR', { title: 'A conta ainda tem saldo, valores a liberar, contestações ou saques em andamento. Resolva antes de encerrar.' });
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.users.update({ where: { id: r.subject_id }, data: { status: 'blocked' } });
        await tx.sessions.updateMany({ where: { user_id: r.subject_id, revoked_at: null }, data: { revoked_at: new Date() } });
        for (const m of owned) {
          await tx.workspaces.update({ where: { id: m.workspace_id }, data: { blocked_at: new Date(), blocked_reason: 'Conta encerrada a pedido do titular' } });
          await tx.offers.updateMany({ where: { workspace_id: m.workspace_id }, data: { status: 'ended' } });
        }
      });
      data = { ...data, status: 'scheduled', retain_until: addYears(new Date(), RETENTION_YEARS), resolution: `${d.resolution} Conta encerrada; dados de identidade e financeiros guardados por ${RETENTION_YEARS} anos (Lei 9.613/1998) e depois anonimizados.` };
    }
    const updated = await this.prisma.privacy_requests.update({ where: { id }, data });
    await this.audit.log({ actorId, action: `privacy.${r.kind}.${d.decision}`, target: `${r.subject_type}:${r.subject_id}`, before: { status: r.status }, after: { status: updated.status }, reason: d.resolution, ipHash });
    const email = r.subject_type === 'user' ? (await this.prisma.users.findUnique({ where: { id: r.subject_id } }))?.email : (await this.prisma.customers.findUnique({ where: { id: r.subject_id } }))?.email;
    if (email && !email.endsWith('@anonimo.invalid')) await this.notify.send({ channel: 'email', to: email, template: 'privacy_request_update', vars: { situacao: updated.status === 'rejected' ? 'não pôde ser atendido' : 'foi atendido', resposta: updated.resolution ?? '' } }).catch(() => {});
    return this.view(updated);
  }
}
