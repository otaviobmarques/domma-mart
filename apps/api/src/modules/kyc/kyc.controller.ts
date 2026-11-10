import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { AuditService } from '../../infra/audit.service';
import { Producer, Ctx, ProducerCtx, Req as R, clientIp } from '../../http/context';
import { parse, z } from '../../http/zod';
import { AppError } from '../../common/errors';
import { encrypt, blindIndex, base62, hashIp } from '../../common/crypto';
import { isValidCPF, isValidCNPJ, onlyDigits } from '../../domain/validators';
import { toJSON } from '../../http/json';

const IMG = z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).max(8_000_000);

/** Confirmar identidade (5.1 e tela 19.12 b). Análise manual na Fase 1. */
@Controller('v1/identity')
export class KycController {
  constructor(private prisma: PrismaService, private storage: StorageService, private audit: AuditService) {}

  @Get() @Producer()
  async status(@Ctx() c: ProducerCtx) {
    const ws = await this.prisma.workspaces.findUniqueOrThrow({ where: { id: c.workspaceId } });
    const last = await this.prisma.kyc_submissions.findFirst({ where: { workspace_id: c.workspaceId }, orderBy: { created_at: 'desc' } });
    return toJSON({ status: ws.kyc_status, person_type: ws.person_type, last: last && { status: last.status, created_at: last.created_at, decision_reason: last.status === 'approved' ? null : last.decision_reason } });
  }

  @Post() @Producer('settings.manage') @HttpCode(200)
  async submit(@Ctx() c: ProducerCtx, @Body() b: any, @Req() req: R) {
    const d = parse(z.object({
      person_type: z.enum(['pf', 'pj']), name: z.string().min(3).max(160), document: z.string().max(20),
      birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), partner_name: z.string().max(160).optional(), partner_document: z.string().max(20).optional(),
      doc_front: IMG, doc_back: IMG.optional(), selfie: IMG,
    }), b);
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
      doc_front_key: save(d.doc_front, 'front'), doc_back_key: d.doc_back ? save(d.doc_back, 'back') : null, selfie_key: save(d.selfie, 'selfie'),
      auto_checks: checks, risk: fails >= 2 ? 'high' : fails === 1 ? 'medium' : 'low', status: 'in_review',
    } });
    await this.prisma.workspaces.update({ where: { id: c.workspaceId }, data: { kyc_status: 'in_review', person_type: d.person_type, name: d.name, document_enc: encrypt(doc), document_hash: blindIndex(doc) } });
    await this.audit.log({ actorId: c.userId, action: 'kyc.submit', target: `workspace:${c.workspaceId}`, after: { submission: sub.id, risk: sub.risk }, ipHash: hashIp(clientIp(req)) });
    return { status: 'in_review', message: 'Em análise — avisamos em até 1 dia útil.' };
  }
}
