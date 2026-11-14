import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { ApiKey, Key, ApiKeyCtx, ProducerCtx, ALL_PERMISSIONS } from '../../http/context';
import { AppError } from '../../common/errors';
import { maskEmail } from '../../domain/validators';
import { ProductsController } from '../products/products.controller';
import { ExperimentsController } from '../products/experiments.controller';

const uuid = (id: string) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND'); return id; };

/**
 * API pública — escrita (Fase 2): criar e configurar produtos, ofertas, oferta especial (order bump),
 * upsell/downsell, conteúdo em texto ou link, materiais de afiliado, teste A/B e afiliações.
 * Cada rota chama exatamente a mesma regra do painel (validações, moderação ao publicar, auditoria),
 * em nome de quem criou a chave e sempre na conta da chave. Envio de arquivos (vídeo, PDF, capa) segue pelo painel.
 */
@Controller('api/v1')
export class PublicWriteController {
  constructor(private prisma: PrismaService, private products: ProductsController, private experiments: ExperimentsController) {}

  /** A chave age como o dono da conta que a criou, limitada à conta da chave. */
  private async as(k: ApiKeyCtx): Promise<ProducerCtx> {
    const key = await this.prisma.api_keys.findUniqueOrThrow({ where: { id: k.keyId } });
    return { userId: key.created_by, email: '', name: `API: ${key.name}`, workspaceId: k.workspaceId, role: 'owner', permissions: [...ALL_PERMISSIONS], platformRole: 'none', sessionId: '', totpEnabled: true };
  }

  // ───── Produtos ─────
  @Get('products/:id') @ApiKey('products:read')
  async product(@Key() k: ApiKeyCtx, @Param('id') id: string) {
    const p: any = await this.products.get(await this.as(k), uuid(id));
    // e-mails de afiliados e sócios mascarados, como no resto da API
    return { ...p, affiliations: p.affiliations?.map((a: any) => ({ ...a, email: a.email ? maskEmail(a.email) : null })), coproductions: p.coproductions?.map((c: any) => ({ ...c, invited_email: c.invited_email ? maskEmail(c.invited_email) : null })) };
  }

  @Post('products') @ApiKey('products:write')
  async createProduct(@Key() k: ApiKeyCtx, @Body() b: any) { return this.products.create(await this.as(k), b); }

  @Patch('products/:id') @ApiKey('products:write')
  async patchProduct(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.products.patch(await this.as(k), uuid(id), b); }

  @Delete('products/:id') @ApiKey('products:write') @HttpCode(200)
  async deleteProduct(@Key() k: ApiKeyCtx, @Param('id') id: string) { return this.products.remove(await this.as(k), uuid(id)); }

  /** Publicar: mesma moderação automática do painel (pode voltar "in_review"). */
  @Post('products/:id/publish') @ApiKey('products:write') @HttpCode(200)
  async publish(@Key() k: ApiKeyCtx, @Param('id') id: string) {
    return this.products.publish(await this.as(k), uuid(id), { status: () => undefined } as any);
  }

  // ───── Ofertas, oferta especial (order bump), upsell/downsell ─────
  @Post('products/:id/offers') @ApiKey('products:write')
  async addOffer(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.products.addOffer(await this.as(k), uuid(id), b); }

  @Patch('offers/:id') @ApiKey('products:write')
  async patchOffer(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.products.patchOffer(await this.as(k), uuid(id), b); }

  @Post('offers/:id/duplicate') @ApiKey('products:write')
  async duplicate(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.experiments.duplicate(await this.as(k), uuid(id), b); }

  /** Order bump: lista completa (substitui a anterior), até 3 ofertas. */
  @Put('offers/:id/bumps') @ApiKey('products:write')
  async bumps(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.products.bumps(await this.as(k), uuid(id), b); }

  /** Upsell e downsell com 1 clique na página de obrigado. */
  @Put('offers/:id/funnel') @ApiKey('products:write')
  async funnel(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.products.funnel(await this.as(k), uuid(id), b); }

  // ───── Conteúdo (módulos e aulas em texto ou link) ─────
  @Post('products/:id/modules') @ApiKey('products:write')
  async addModule(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.products.addModule(await this.as(k), uuid(id), b); }

  @Patch('modules/:id') @ApiKey('products:write')
  async patchModule(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { await this.module(k, id); return this.products.patchModule(await this.as(k), id, b); }

  @Post('modules/:id/lessons') @ApiKey('products:write')
  async addLesson(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { await this.module(k, id); return this.products.addLesson(await this.as(k), id, b); }

  @Patch('lessons/:id') @ApiKey('products:write')
  async patchLesson(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { await this.lesson(k, id); return this.products.patchLesson(await this.as(k), id, b); }

  @Delete('lessons/:id') @ApiKey('products:write') @HttpCode(200)
  async deleteLesson(@Key() k: ApiKeyCtx, @Param('id') id: string) { await this.lesson(k, id); return this.products.deleteLesson(await this.as(k), id); }

  /** id inexistente → 404 (sem vazar se existe em outra conta). */
  private async module(k: ApiKeyCtx, id: string) {
    const m = await this.prisma.course_modules.findUnique({ where: { id: uuid(id) } });
    const p = m && (await this.prisma.products.findFirst({ where: { id: m.product_id, workspace_id: k.workspaceId, deleted_at: null } }));
    if (!p) throw new AppError('NOT_FOUND');
  }
  private async lesson(k: ApiKeyCtx, id: string) {
    const l = await this.prisma.lessons.findUnique({ where: { id: uuid(id) } });
    const p = l && (await this.prisma.products.findFirst({ where: { id: l.product_id, workspace_id: k.workspaceId, deleted_at: null } }));
    if (!p) throw new AppError('NOT_FOUND');
  }

  // ───── Materiais para afiliados ─────
  @Post('products/:id/materials') @ApiKey('products:write')
  async addMaterial(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.products.addMaterial(await this.as(k), uuid(id), b); }

  @Delete('materials/:id') @ApiKey('products:write') @HttpCode(200)
  async removeMaterial(@Key() k: ApiKeyCtx, @Param('id') id: string) { return this.products.removeMaterial(await this.as(k), uuid(id)); }

  // ───── Teste A/B ─────
  @Get('products/:id/experiments') @ApiKey('products:read')
  async listExperiments(@Key() k: ApiKeyCtx, @Param('id') id: string) { return this.experiments.list(await this.as(k), uuid(id)); }

  @Post('products/:id/experiments') @ApiKey('products:write')
  async startExperiment(@Key() k: ApiKeyCtx, @Param('id') id: string, @Body() b: any) { return this.experiments.create(await this.as(k), uuid(id), b); }

  @Post('experiments/:id/:action') @ApiKey('products:write') @HttpCode(200)
  async experimentAction(@Key() k: ApiKeyCtx, @Param('id') id: string, @Param('action') action: string, @Body() b: any) {
    return this.experiments.act(await this.as(k), uuid(id), action, b ?? {});
  }

  // ───── Afiliações: aprovar ou bloquear ─────
  @Post('affiliates/:id/:action') @ApiKey('affiliates:write') @HttpCode(200)
  async affiliation(@Key() k: ApiKeyCtx, @Param('id') id: string, @Param('action') action: string) {
    return this.products.affAction(await this.as(k), uuid(id), action);
  }
}
