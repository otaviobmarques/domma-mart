import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { GATEWAY, GatewayAdapter, BankAccount, RecipientProfile } from '../gateway/gateway.types';
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
    return { kind: p.kind, pix_key_masked: p.pix_key_mask, holder_name: p.holder_name, active_from: p.active_from, cooling_down: p.active_from > new Date() };
  }

  /** Conta bancária de mesma titularidade (gateways que só transferem para conta cadastrada, ex.: Pagar.me). */
  async setBankAccount(workspaceId: string, userId: string, bank: Omit<BankAccount, 'holderName' | 'holderDocument'>, otp: string | undefined, ipHash: string) {
    await this.checkOtp(userId, otp);
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: workspaceId } });
    if (!ws.document_hash || !ws.document_enc) throw new AppError('KYC_REQUIRED');
    const kyc = await this.prisma.kyc_submissions.findFirst({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'desc' } });
    if (!kyc) throw new AppError('KYC_REQUIRED');
    const account: BankAccount = { ...bank, holderName: kyc.name, holderDocument: decrypt(ws.document_enc) };
    const mask = `Banco ${account.bank} · Ag. ${account.branch} · Conta ****${account.account.slice(-3)}-${account.accountDigit}`;
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: userId } });
    const existing = await this.prisma.payout_accounts.findUnique({ where: { workspace_id: workspaceId } });
    // troca de conta numa subconta já criada: atualiza no gateway antes de gravar
    if (ws.gateway_subaccount_id && this.gateway.updateBankAccount) {
      try { await this.gateway.updateBankAccount(ws.gateway_subaccount_id, account); }
      catch (e) { this.log.error(`conta bancária recusada: ${(e as Error).message}`); throw new AppError('VALIDATION_ERROR', { title: 'O banco não aceitou essa conta. Confira os dados e se ela está no seu CPF/CNPJ.' }); }
    }
    const active_from = new Date(Date.now() + 24 * 3600_000);
    const data = { kind: 'bank_account', pix_key_enc: null, bank_enc: encrypt(JSON.stringify(account)), pix_key_mask: mask, holder_name: kyc.name, holder_doc_hash: ws.document_hash, active_from };
    await this.prisma.payout_accounts.upsert({ where: { workspace_id: workspaceId }, create: { workspace_id: workspaceId, ...data }, update: data });
    await this.audit.log({ actorId: userId, action: 'payout_account.set', target: `workspace:${workspaceId}`, before: existing ? { mask: existing.pix_key_mask } : null, after: { mask }, ipHash });
    await this.notify.send({ channel: 'email', to: user.email, template: 'payout_key_changed', workspaceId, vars: { link: `${process.env.APP_URL}/ajuda` } });
    await this.ensureSubaccount(workspaceId).catch(e => this.log.error(`subconta ${workspaceId}: ${(e as Error).message}`));
    return { pix_key_masked: mask, active_from };
  }

  /** Monta o cadastro completo do recebedor a partir da última identidade enviada e da conta de saque. */
  async recipientProfile(workspaceId: string): Promise<RecipientProfile | null> {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: workspaceId } });
    const kyc = await this.prisma.kyc_submissions.findFirst({ where: { workspace_id: workspaceId, status: { in: ['in_review', 'approved'] } }, orderBy: { created_at: 'desc' } });
    const acct = await this.prisma.payout_accounts.findUnique({ where: { workspace_id: workspaceId } });
    if (!kyc?.extra_enc || !acct?.bank_enc) return null;
    const extra = JSON.parse(decrypt(kyc.extra_enc));
    const owner = await this.prisma.users.findUniqueOrThrow({ where: { id: ws.owner_id } });
    const big = (v: unknown) => (v == null ? undefined : BigInt(v as string));
    return {
      personType: kyc.person_type as 'pf' | 'pj', name: kyc.name, document: decrypt(kyc.document_enc), email: owner.email, phone: extra.phone, address: extra.address,
      birthDate: kyc.birth_date ?? undefined, monthlyIncomeCents: big(extra.monthly_income_cents), occupation: extra.occupation, motherName: extra.mother_name,
      tradingName: extra.trading_name, annualRevenueCents: big(extra.annual_revenue_cents),
      partner: extra.partner ? { ...extra.partner, monthlyIncomeCents: BigInt(extra.partner.monthly_income_cents) } : undefined,
      bankAccount: JSON.parse(decrypt(acct.bank_enc)),
    };
  }

  /**
   * Cria a subconta no gateway assim que houver dados suficientes. Em gateways com conta bancária
   * (Pagar.me) isso acontece quando a identidade foi enviada e a conta de saque cadastrada — antes da
   * aprovação manual, porque o dinheiro das vendas precisa cair no recebedor do produtor desde a 1ª venda.
   * O saque continua liberado só após a aprovação (RN-36).
   */
  async ensureSubaccount(workspaceId: string): Promise<string | null> {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: workspaceId } });
    if (ws.gateway_subaccount_id) return ws.gateway_subaccount_id;
    if (this.gateway.payoutMode !== 'bank_account') {
      if (ws.kyc_status !== 'approved' || !ws.document_enc) return null;
      const { id } = await this.gateway.createSubaccount({ workspaceId, name: ws.name, document: decrypt(ws.document_enc) });
      await this.prisma.workspaces.update({ where: { id: workspaceId }, data: { gateway_subaccount_id: id } });
      return id;
    }
    const profile = await this.recipientProfile(workspaceId);
    if (!profile) return null;
    // um recebedor por conta: trava por workspace (envio de identidade e cadastro de conta podem correr juntos)
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'subaccount:' + workspaceId}))`;
      const again = await tx.workspaces.findUniqueOrThrow({ where: { id: workspaceId } });
      if (again.gateway_subaccount_id) return again.gateway_subaccount_id;
      const { id } = await this.gateway.createSubaccount({ workspaceId, name: profile.name, document: profile.document, profile });
      await tx.workspaces.update({ where: { id: workspaceId }, data: { gateway_subaccount_id: id } });
      await this.audit.log({ actorId: null, action: 'gateway.subaccount_created', target: `workspace:${workspaceId}`, after: { provider: this.gateway.name, id } }, tx);
      return id;
    }, { timeout: 30_000 });
    return id;
  }

  /** Chave Pix de mesma titularidade; nova chave só vale após 24 h (RN-37). */
  async setPayoutAccount(workspaceId: string, userId: string, pixKey: string, otp: string | undefined, ipHash: string) {
    if (this.gateway.payoutMode === 'bank_account') throw new AppError('VALIDATION_ERROR', { title: 'Cadastre uma conta bancária no seu CPF/CNPJ para receber os saques.' });
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
    const data = { kind: 'pix', bank_enc: null, pix_key_enc: encrypt(key), pix_key_mask: mask, holder_name: kyc?.name ?? user.name, holder_doc_hash: ws.document_hash, active_from };
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
    if (!acct || (acct.kind !== (this.gateway.payoutMode === 'bank_account' ? 'bank_account' : 'pix'))) throw new AppError('PAYOUT_ACCOUNT_REQUIRED');
    if (this.gateway.payoutMode === 'bank_account' && !ws.gateway_subaccount_id) throw new AppError('PAYOUT_ACCOUNT_REQUIRED');
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
      const w = await tx.withdrawals.create({ data: { workspace_id: workspaceId, amount_cents: amount, destination_enc: (acct.pix_key_enc ?? acct.bank_enc)!, destination_mask: acct.pix_key_mask, status: 'processing', otp_verified_at: new Date(), idempotency_key: idempotencyKey } });
      // reserva no ledger
      await this.ledger.post(tx, { type: 'withdrawal', id: w.id }, [
        { owner_type: 'workspace', owner_id: workspaceId, bucket: 'balance', debit: amount, description: 'Saque para sua conta' },
        { owner_type: 'gateway', owner_id: null, bucket: 'clearing', credit: amount, description: acct.kind === 'pix' ? 'Saque Pix' : 'Saque para conta bancária' },
      ], userId);
      return w;
    });
    await this.audit.log({ actorId: userId, action: 'withdrawal.request', target: `withdrawal:${w.id}`, after: { amount: amount.toString() }, ipHash });
    try {
      const t = await this.gateway.transfer({ subaccountId: ws.gateway_subaccount_id, pixKey: acct.pix_key_enc ? decrypt(acct.pix_key_enc) : undefined, amountCents: amount, idempotencyKey: `wd:${w.id}` });
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
