import { trustedClientIp } from './edge';
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export interface ProducerCtx {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  role: string;
  permissions: string[];
  platformRole: string;
  sessionId: string;
  totpEnabled: boolean;
}
export interface CustomerCtx { customerId: string; email: string; sessionId: string }

/** Requisição da API pública autenticada por chave (Authorization: Bearer dm_live_...). */
export interface ApiKeyCtx { keyId: string; workspaceId: string; scopes: string[] }

export type Req = Request & { producer?: ProducerCtx; customer?: CustomerCtx; apiKey?: ApiKeyCtx; rawBody?: Buffer };

export const ALL_PERMISSIONS = [
  'dashboard.view', 'products.edit', 'orders.view', 'orders.refund', 'finance.view', 'finance.withdraw',
  'affiliates.manage', 'settings.manage', 'team.manage',
] as const;

export const AUTH_KEY = 'auth';
export type AuthSpec = { kind: 'producer'; perm?: string } | { kind: 'customer' } | { kind: 'admin'; perm?: string } | { kind: 'apikey'; scope?: string } | { kind: 'public' };
export const Producer = (perm?: string) => SetMetadata(AUTH_KEY, { kind: 'producer', perm });
export const Customer = () => SetMetadata(AUTH_KEY, { kind: 'customer' });
export const Admin = (perm?: string) => SetMetadata(AUTH_KEY, { kind: 'admin', perm });
export const Public = () => SetMetadata(AUTH_KEY, { kind: 'public' });
/** Rota da API pública: exige chave válida com esta permissão (scope). */
export const ApiKey = (scope?: string) => SetMetadata(AUTH_KEY, { kind: 'apikey', scope });
export const Key = createParamDecorator((_d, c: ExecutionContext) => c.switchToHttp().getRequest<Req>().apiKey!);

export const Ctx = createParamDecorator((_d, c: ExecutionContext) => c.switchToHttp().getRequest<Req>().producer!);
export const Cust = createParamDecorator((_d, c: ExecutionContext) => c.switchToHttp().getRequest<Req>().customer!);

export function clientIp(req: Request): string {
  return trustedClientIp(req as any);
}

/** Permissões internas Domma por papel (seção 2). */
export const PLATFORM_PERMS: Record<string, string[]> = {
  support: ['admin.view', 'orders.lookup'],
  compliance: ['admin.view', 'orders.lookup', 'kyc.view', 'kyc.decide', 'moderation.decide', 'disputes.manage', 'risk.manage', 'privacy.manage'],
  finance: ['admin.view', 'orders.lookup', 'reconciliation.view', 'ledger.adjust', 'fees.manage'],
  super_admin: ['admin.view', 'orders.lookup', 'kyc.view', 'kyc.decide', 'moderation.decide', 'disputes.manage', 'risk.manage', 'reconciliation.view', 'ledger.adjust', 'fees.manage', 'audit.view', 'privacy.manage'],
};
