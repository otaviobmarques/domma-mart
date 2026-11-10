import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { AppError } from '../../common/errors';
import { decrypt, encrypt, blindIndex } from '../../common/crypto';
import { verifyTotp } from '../../common/totp';
import { NotifyService } from '../../infra/notify.service';
import { AuditService } from '../../infra/audit.service';
import { formatBRL } from '../../domain/money';
import { isValidDocument, onlyDigits } from '../../domain/validators';

const MIN_WITHDRAW = 1000n; // RN-36

@Injectable()
export class FinanceService {
  private log = new Logger('Finance');
  constructor(
    private prisma: PrismaService, private ledger: LedgerService, private notify: NotifyService, private audit: AuditService,
    @Inject(GATEWAY) private gateway: GatewayAdapter,
  ) {}

  async balance(workspaceId: string) {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: workspaceId } });
    return { ...(await this.ledger.balance(workspaceId)), daily_limit_cents: ws.daily_withdraw_limit };
  }

  /** Valida o código 2FA com bloqueio após 5 erros por 30 min (tela 19.9). */
  async checkOtp(userId: string, code: string | undefined) {
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: userId } });
    if (!u.totp_enabled_at || !u.totp_secret_enc) throw new AppError('TWO_FACTOR_REQUIRED');
    if (u.otp_locked_until && u.otp_locked_until > new Date()) throw new AppError('OTP_LOCKED');
    if (!code || !verifyTotp(decrypt(u.totp_secret_enc), code)) {
      const failed = u.otp_failed + 1;
      const lock = failed >= 5;
      await this.prisma.users.update({ where: { id: userId }, data: { otp_failed: lock ? 0 : failed, otp_locked_until: lock ? new Date(Date.now() + 30 * 60_000) : undefined } });
      if (lock) {
        await this.notify.send({ channel: 'email', to: u.email, template: 'recovery', vars: { produtor: 'Domma Mart', texto: 'Bloqueamos os saques da sua conta por 30 minutos depois de 5 códigos errados. Se não foi você, troque sua senha.', descadastro: '' } });
        throw new AppError('OTP_LOCKED');
      }
      throw new AppError('OTP_INVALID');
    }
    if (u.otp_failed) await this.prisma.users.update({ where: { id: userId }, data: { otp_failed: 0 } });
  }

  async payoutAccount(workspaceId: string) {
    const p = await this.prisma.payout_accounts.findUnique({ where: { workspace_id: workspaceId } });
    if (!p) return null;
    return { pix_key_masked: p.pix_key_mask, holder_name: p.holder_name, active_from: p.active_from, cooling_down: p.active_from > new Date() };
  }

  /** Chave Pix de mesma titularidade; nova chave só vale após 24 h (RN-37). */
  async setPayoutAccount(workspaceId: string, userId: string, pixKey: string, otp: string | undefined, ipHash: string) {
    await this.checkOtp(userId, otp);
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: workspaceId } });
    if (!ws.document_hash) throw new AppError('KYC_REQUIRED');
    const key = pixKey.trim();
    const digits = onlyDigits(key);
    // Mesma titularidade: chave CPF/CNPJ precisa ser o documento da conta. Outras chaves (e-mail,
    // telefone, aleatória) são validadas pelo gateway no DICT antes da 1ª transferência.
    if (isValidDocument(digits) && blindIndex(digits) !== ws.document_hash) throw new AppError('VALIDATION_ERROR', { fields: { pix_key: 'A chave precisa estar no seu CPF/CNPJ.' } });
    const mask = key.includes('@') ? key.replace(/^(.{2}).*(@.*)$/, '$1***$2') : key.replace(/.(?=.{4})/g, '*');
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: userId } });
    const kyc = await this.prisma.kyc_submissions.findFirst({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'desc' } });
    const existing = await this.prisma.payout_accounts.findUnique({ where: { workspace_id: workspaceId } });
    const active_from = new Date(Date.now() + 24 * 3600_000);
    const data = { pix_key_enc: encrypt(key), pix_key_mask: mask, holder_name: kyc?.name ?? user.name, holder_doc_hash: ws.document_hash, active_from };
    await this.prisma.payout_accounts.upsert({ where: { workspace_id: workspaceId }, create: { workspace_id: workspaceId, ...data }, update: data });
    await this.audit.log({ actorId: userId, action: 'payout_account.set', target: `workspace:${workspaceId}`, before: existing ? { mask: existing.pix_key_mask } : null, after: { mask }, ipHash });
    await this.notify.send({ channel: 'email', to: user.email, template: 'payout_key_changed', workspaceId, vars: { link: `${process.env.APP_URL}/ajuda` } });
    return { pix_key_masked: mask, active_from };
  }

  /** Saque (seção 8.4, RN-36/37). Concorrência protegida por lock por workspace. */
  async withdraw(workspaceId: string, userId: string, amount: bigint, otp: string | undefined, idempotencyKey: string, ipHash: string) {
    const prior = await this.prisma.withdrawals.findUnique({ where: { idempotency_key: idempotencyKey } });
    if (prior) return { withdrawal_id: prior.id, status: prior.status };
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: workspaceId } });
    if (ws.blocked_at) throw new AppError('ACCOUNT_BLOCKED');
    if (ws.kyc_status !== 'approved') throw new AppError('KYC_REQUIRED');
    await this.checkOtp(userId, otp);
    if (amount < MIN_WITHDRAW) throw new AppError('WITHDRAWAL_MIN');
    const acct = await this.prisma.payout_accounts.findUnique({ where: { workspace_id: workspaceId } });
    if (!acct) throw new AppError('PAYOUT_ACCOUNT_REQUIRED');
    if (acct.active_from > new Date()) {
      throw new AppError('PAYOUT_DESTINATION_COOLDOWN', { title: `Sua nova chave Pix poderá receber saques a partir de ${acct.active_from.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}.` });
    }
    const w = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      const bal = await this.ledger.balance(workspaceId, tx);
      if (amount > bal.available_cents) throw new AppError('INSUFFICIENT_BALANCE');
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const today = await tx.withdrawals.findMany({ where: { workspace_id: workspaceId, created_at: { gte: since }, status: { in: ['requested', 'processing', 'paid'] } } });
      const sum = today.reduce((s, x) => s + x.amount_cents, 0n);
      if (sum + amount > ws.daily_withdraw_limit) throw new AppError('DAILY_LIMIT_REACHED');
      if (today.length >= 1 && process.env.ALLOW_MULTI_WITHDRAW !== '1') throw new AppError('DAILY_LIMIT_REACHED', { title: 'Você já fez o saque grátis de hoje. Tente amanhã.' });
      const w = await tx.withdrawals.create({ data: { workspace_id: workspaceId, amount_cents: amount, destination_enc: acct.pix_key_enc, destination_mask: acct.pix_key_mask, status: 'processing', otp_verified_at: new Date(), idempotency_key: idempotencyKey } });
      // reserva no ledger
      await this.ledger.post(tx, { type: 'withdrawal', id: w.id }, [
        { owner_type: 'workspace', owner_id: workspaceId, bucket: 'balance', debit: amount, description: 'Saque para sua conta' },
        { owner_type: 'gateway', owner_id: null, bucket: 'clearing', credit: amount, description: 'Saque Pix' },
      ], userId);
      return w;
    });
    await this.audit.log({ actorId: userId, action: 'withdrawal.request', target: `withdrawal:${w.id}`, after: { amount: amount.toString() }, ipHash });
    try {
      const t = await this.gateway.transfer({ subaccountId: ws.gateway_subaccount_id, pixKey: decrypt(acct.pix_key_enc), amountCents: amount, idempotencyKey: `wd:${w.id}` });
      await this.prisma.withdrawals.update({ where: { id: w.id }, data: { provider_transfer_id: t.transferId } });
    } catch (e) {
      await this.failWithdrawal(w.id, 'Falha ao enviar a transferência');
    }
    return { withdrawal_id: w.id, status: 'processing' };
  }

  async onTransfer(transferId: string, ok: boolean, reason?: string) {
    const w = await this.prisma.withdrawals.findFirst({ where: { provider_transfer_id: transferId } });
    if (!w || w.status !== 'processing') return;
    if (!ok) return this.failWithdrawal(w.id, reason ?? 'Transferência recusada');
    await this.prisma.withdrawals.update({ where: { id: w.id }, data: { status: 'paid' } });
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: w.workspace_id } });
    const owner = await this.prisma.users.findUniqueOrThrow({ where: { id: ws.owner_id } });
    await this.notify.send({ channel: 'email', to: owner.email, template: 'withdrawal_done', workspaceId: ws.id, vars: { valor: formatBRL(w.amount_cents), chave_mascarada: w.destination_mask } });
  }

  /** Falha na transferência → estorno da reserva e aviso (8.4, passo 4). */
  async failWithdrawal(id: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const w = await tx.withdrawals.findUniqueOrThrow({ where: { id } });
      if (w.status !== 'processing') return;
      await tx.withdrawals.update({ where: { id }, data: { status: 'failed', failure_reason: reason } });
      await this.ledger.post(tx, { type: 'withdrawal', id }, [
        { owner_type: 'gateway', owner_id: null, bucket: 'clearing', debit: w.amount_cents, description: 'Saque devolvido' },
        { owner_type: 'workspace', owner_id: w.workspace_id, bucket: 'balance', credit: w.amount_cents, description: `Saque não concluído: ${reason}` },
      ]);
    });
  }
}
