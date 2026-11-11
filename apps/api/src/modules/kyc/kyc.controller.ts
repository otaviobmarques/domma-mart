import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { AuditService } from '../../infra/audit.service';
import { Producer, Ctx, ProducerCtx, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { encrypt, blindIndex, base62, hashIp } from '../../common/crypto';
import { isValidCPF, isValidCNPJ, onlyDigits } from '../../domain/validators';
import { toJSON } from '../../http/json';
import { FinanceService } from '../finance/finance.service';
import { GATEWAY, GatewayAdapter } from '../gateway/gateway.types';
import { normalizeBRMobile } from '../../domain/validators';

const UF = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const Address = z.object({
  zip: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido.'), street: z.string().min(2).max(120), number: z.string().min(1).max(10), complement: z.string().max(60).optional(),
  district: z.string().min(2).max(60), city: z.string().min(2).max(60), state: z.string().refine(v => UF.includes(v.toUpperCase()), 'UF inválida.'),
});
const Money = z.number().int().min(0).max(100_000_000_000);
/** Dados exigidos pelos gateways para abrir a subconta do recebedor (Circular Bacen 3.978/20). */
const Extra = z.object({
  phone: z.string().max(20), address: Address,
  monthly_income_cents: Money.optional(), occupation: z.string().min(2).max(80).optional(), mother_name: z.string().max(160).optional(),
  trading_name: z.string().max(160).optional(), annual_revenue_cents: Money.optional(),
  partner_email: z.string().email().max(200).optional(), partner_birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  partner_monthly_income_cents: Money.optional(), partner_occupation: z.string().min(2).max(80).optional(),
});

const IMG = z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).max(8_000_000);

/** Confirmar identidade (5.1 e tela 19.12 b). Análise manual na Fase 1. */
@Controller('v1/identity')
export class KycController {
  private log = new Logger('Kyc');
  constructor(private prisma: PrismaService, private storage: StorageService, private audit: AuditService, private finance: FinanceService, @Inject(GATEWAY) private gateway: GatewayAdapter) {}

  @Get() @Producer()
  async status(@Ctx() c: ProducerCtx) {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: c.workspaceId } });
    const last = await this.prisma.kyc_submissions.findFirst({ where: { workspace_id: c.workspaceId }, orderBy: { created_at: 'desc' } });
    return toJSON({ status: ws.kyc_status, person_type: ws.person_type, extra_required: this.gateway.payoutMode === 'bank_account', receiving_ready: !!ws.gateway_subaccount_id || this.gateway.payoutMode !== 'bank_account', last: last && { status: last.status, created_at: last.created_at, decision_reason: last.status === 'approved' ? null : last.decision_reason } });
  }

  @Post() @Producer('settings.manage') @HttpCode(200)
  async submit(@Ctx() c: ProducerCtx, @Body() b: any, @Req() req: R) {
    const d = parse(z.object({
      person_type: z.enum(['pf', 'pj']), name: z.string().min(3).max(160), document: z.string().max(20),
      birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), partner_name: z.string().max(160).optional(), partner_document: z.string().max(20).optional(),
      doc_front: IMG, doc_back: IMG.optional(), selfie: IMG, extra: Extra.optional(),
    }), b);
    const extraRequired = this.gateway.payoutMode === 'bank_account';
    if (extraRequired && !d.extra) throw new AppError('VALIDATION_ERROR', { fields: { extra: 'Preencha endereço, telefone e renda.' } });
    if (d.extra) {
      const e = d.extra;
      if (!normalizeBRMobile(e.phone)) throw new AppError('VALIDATION_ERROR', { fields: { phone: 'Celular inválido. Use DDD + número.' } });
      if (d.person_type === 'pf' && extraRequired && (e.monthly_income_cents == null || !e.occupation)) throw new AppError('VALIDATION_ERROR', { fields: { occupation: 'Informe sua profissão e renda mensal.' } });
      if (d.person_type === 'pj' && extraRequired && (e.annual_revenue_cents == null || !e.partner_birth_date || e.partner_monthly_income_cents == null || !e.partner_occupation || !e.partner_email)) throw new AppError('VALIDATION_ERROR', { fields: { partner_occupation: 'Preencha faturamento e os dados do sócio responsável.' } });
    }
    const doc = onlyDigits(d.document);
    if (d.person_type === 'pf' ? !isValidCPF(doc) : !isValidCNPJ(doc)) throw new AppError('CPF_INVALID', { fields: { document: d.person_type === 'pf' ? 'CPF inválido. Confira os números.' : 'CNPJ inválido. Confira os números.' } });
    if (d.person_type === 'pj' && (!d.partner_name || !d.partner_document || !isValidCPF(d.partner_document))) throw new AppError('VALIDATION_ERROR', { fields: { partner_document: 'Informe o CPF do sócio responsável.' } });
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: c.workspaceId } });
    if (ws.kyc_status === 'approved' || ws.kyc_status === 'blocked') throw new AppError('VALIDATION_ERROR', { title: 'Sua identidade já foi analisada.' });
    // documento já usado por outra conta?
    const dup = await this.prisma.workspaces.findFirst({ where: { document_hash: blindIndex(doc), id: { not: c.workspaceId } } });
    const save = (dataUrl: string, name: string) => {
      const [meta, b64] = dataUrl.split(',');
      const ext = meta.includes('png') ? 'png' : meta.includes('webp') ? 'webp' : 'jpg';
      const key = `kyc/${c.workspaceId}/${base62(16)}-${name}.${ext}`;
      this.storage.write(key, Buffer.from(b64, 'base64'));
      return key;
    };
    let age: number | null = null;
    if (d.birth_date) age = Math.floor((Date.now() - new Date(d.birth_date).getTime()) / (365.25 * 86400000));
    // Verificações automáticas (Fase 1: indicativas; consulta à Receita entra pelo provedor de dados)
    const checks = [
      { key: 'document_valid', label: d.person_type === 'pf' ? 'CPF com dígitos válidos' : 'CNPJ com dígitos válidos', ok: true },
      { key: 'document_unique', label: 'Documento não usado em outra conta', ok: !dup },
      { key: 'adult', label: 'Maior de 18 anos', ok: d.person_type === 'pj' || (age != null && age >= 18) },
      { key: 'name_match', label: 'Nome do cadastro confere com o informado', ok: c.name.split(' ')[0].toLowerCase() === d.name.split(' ')[0].toLowerCase() || d.person_type === 'pj' },
      { key: 'selfie_present', label: 'Selfie enviada', ok: true },
      { key: 'receita_status', label: 'Situação cadastral na Receita', ok: null as boolean | null },
    ];
    const fails = checks.filter(x => x.ok === false).length;
    const sub = await this.prisma.kyc_submissions.create({ data: {
      workspace_id: c.workspaceId, person_type: d.person_type, name: d.name, document_enc: encrypt(doc), document_last4: doc.slice(-4), birth_date: d.birth_date, partner_name: d.partner_name,
      extra_enc: d.extra ? encrypt(JSON.stringify({
        phone: normalizeBRMobile(d.extra.phone), address: { ...d.extra.address, zip: onlyDigits(d.extra.address.zip), state: d.extra.address.state.toUpperCase() },
        monthly_income_cents: d.extra.monthly_income_cents?.toString(), occupation: d.extra.occupation, mother_name: d.extra.mother_name,
        trading_name: d.extra.trading_name, annual_revenue_cents: d.extra.annual_revenue_cents?.toString(),
        partner: d.person_type === 'pj' && d.partner_name && d.partner_document && d.extra.partner_birth_date ? {
          name: d.partner_name, document: onlyDigits(d.partner_document), email: d.extra.partner_email, birthDate: d.extra.partner_birth_date,
          monthly_income_cents: String(d.extra.partner_monthly_income_cents ?? 0), occupation: d.extra.partner_occupation,
        } : undefined,
      })) : null,
      doc_front_key: save(d.doc_front, 'front'), doc_back_key: d.doc_back ? save(d.doc_back, 'back') : null, selfie_key: save(d.selfie, 'selfie'),
      auto_checks: checks, risk: fails >= 2 ? 'high' : fails === 1 ? 'medium' : 'low', status: 'in_review',
    } });
    await this.prisma.workspaces.update({ where: { id: c.workspaceId }, data: { kyc_status: 'in_review', person_type: d.person_type, name: d.name, document_enc: encrypt(doc), document_hash: blindIndex(doc) } });
    // se a conta de saque já existe, abre a subconta agora (Pagar.me)
    await this.finance.ensureSubaccount(c.workspaceId).catch(e => this.log.error(`subconta ${c.workspaceId}: ${(e as Error).message}`));
    await this.audit.log({ actorId: c.userId, action: 'kyc.submit', target: `workspace:${c.workspaceId}`, after: { submission: sub.id, risk: sub.risk }, ipHash: hashIp(clientIp(req)) });
    return { status: 'in_review', message: 'Em análise — avisamos em até 1 dia útil.' };
  }
}
