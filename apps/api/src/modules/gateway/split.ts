import type { PrismaService } from '../../infra/prisma.service';
import type { SplitRule } from './gateway.types';

/** Converte a divisão do pedido nas regras do gateway, com a subconta de cada beneficiário (plataforma = null). */
export async function gatewaySplit(prisma: PrismaService, splits: { beneficiary_type: string; beneficiary_id: string | null; amount_cents: bigint }[]): Promise<SplitRule[]> {
  const ids = splits.map(s => s.beneficiary_id).filter(Boolean) as string[];
  const ws = ids.length ? await prisma.workspaces.findMany({ where: { id: { in: ids } }, select: { id: true, gateway_subaccount_id: true } }) : [];
  return splits.map(s => ({ kind: s.beneficiary_type, amountCents: s.amount_cents, subaccountId: ws.find(w => w.id === s.beneficiary_id)?.gateway_subaccount_id ?? null }));
}
