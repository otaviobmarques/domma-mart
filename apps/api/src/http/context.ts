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

export type Req = Request & { producer?: ProducerCtx; customer?: CustomerCtx; rawBody?: Buffer };

export const ALL_PERMISSIONS = [
  'dashboard.view', 'products.edit', 'orders.view', 'orders.refund', 'finance.view', 'finance.withdraw',
  'affiliates.manage', 'settings.manage', 'team.manage',
] as const;

export const AUTH_KEY = 'auth';
export type AuthSpec = { kind: 'producer'; perm?: string } | { kind: 'customer' } | { kind: 'admin'; perm?: string } | { kind: 'public' };
export const Producer = (perm?: string) => SetMetadata(AUTH_KEY, { kind: 'producer', perm });
export const Customer = () => SetMetadata(AUTH_KEY, { kind: 'customer' });
export const Admin = (perm?: string) => SetMetadata(AUTH_KEY, { kind: 'admin', perm });
export const Public = () => SetMetadata(AUTH_KEY, { kind: 'public' });

export const Ctx = createParamDecorator((_d, c: ExecutionContext) => c.switchToHttp().getRequest<Req>().producer!);
export const Cust = createParamDecorator((_d, c: ExecutionContext) => c.switchToHttp().getRequest<Req>().customer!);

export function clientIp(req: Request): string {
  return (req.headers['cf-connecting-ip'] as string) || (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
}

/** Permissões internas Domma por papel (seção 2). */
export const PLATFORM_PERMS: Record<string, string[]> = {
  support: ['admin.view', 'orders.lookup'],
  compliance: ['admin.view', 'orders.lookup', 'kyc.view', 'kyc.decide', 'moderation.decide', 'disputes.manage', 'risk.manage'],
  finance: ['admin.view', 'orders.lookup', 'reconciliation.view', 'ledger.adjust', 'fees.manage'],
  super_admin: ['admin.view', 'orders.lookup', 'kyc.view', 'kyc.decide', 'moderation.decide', 'disputes.manage', 'risk.manage', 'reconciliation.view', 'ledger.adjust', 'fees.manage', 'audit.view'],
};
