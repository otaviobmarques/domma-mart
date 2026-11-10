/**
 * Interface única de gateway (seção 6.3): createCharge, refund, createSubaccount, split, transfer.
 * Cada provedor (Asaas, Pagar.me, Mercado Pago) implementa este contrato; o resto do sistema
 * nunca conhece o provedor. Dados de cartão chegam só como token gerado no navegador (P4/RN-63).
 */
export type ChargeStatus = 'pending' | 'authorized' | 'paid' | 'declined' | 'refunded' | 'expired';

export interface SplitRule { subaccountId: string | null; amountCents: bigint; kind: string }

export interface CreateChargeInput {
  idempotencyKey: string;
  orderId: string;
  method: 'pix' | 'card' | 'boleto';
  amountCents: bigint;
  installments: number;
  description: string;
  customer: { name: string; email: string; document: string; phone: string };
  cardToken?: string;
  pixExpiresAt?: Date;
  boletoDueAt?: Date;
  split: SplitRule[];
}

export interface ChargeResult {
  chargeId: string;
  status: ChargeStatus;
  rawStatus: string;
  declineCode?: string;
  riskScore?: number;
  card?: { brand: string; last4: string; tokenRef?: string };
  pix?: { qrDataUrl: string; copyPaste: string; expiresAt: Date };
  boleto?: { url: string; line: string; dueAt: Date };
}

export type GatewayEvent =
  | { eventId: string; type: 'charge.paid' | 'charge.expired' | 'charge.refunded' | 'charge.declined'; chargeId: string }
  | { eventId: string; type: 'charge.chargeback' | 'charge.chargeback_won' | 'charge.chargeback_lost'; chargeId: string }
  | { eventId: string; type: 'transfer.paid' | 'transfer.failed'; transferId: string; reason?: string };

export interface GatewayAdapter {
  readonly name: string;
  createSubaccount(input: { workspaceId: string; name: string; document: string }): Promise<{ id: string }>;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  getCharge(chargeId: string): Promise<{ status: ChargeStatus; rawStatus: string } | null>;
  refund(input: { chargeId: string; amountCents: bigint; idempotencyKey: string }): Promise<{ refundId: string; status: 'processing' | 'done' }>;
  transfer(input: { subaccountId: string | null; pixKey: string; amountCents: bigint; idempotencyKey: string }): Promise<{ transferId: string }>;
  /** Valida assinatura e normaliza o evento. Lança erro se a assinatura for inválida. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent;
  /** Extrato de liquidações do dia para conciliação (seção 5.4). */
  settlements(day: Date): Promise<{ chargeId: string; amountCents: bigint; type: 'credit' | 'debit' }[]>;
}

export const GATEWAY = Symbol('GATEWAY');
