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
  /** Cartão já guardado (renovação de assinatura): referência devolvida em card.tokenRef. */
  savedCardRef?: string;
  /** Uso do cartão guardado: renovação de assinatura (recorrente) ou compra com 1 clique iniciada pelo comprador. */
  cardOnFile?: 'recurring' | 'one_click';
  /** Autenticação 3-D Secure feita no navegador (id da transação no servidor 3DS). */
  threeDS?: { transactionId: string; status: string };
  /** Endereço de cobrança do cartão, quando o comprador informou. */
  billingAddress?: Address;
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
  | { eventId: string; type: 'transfer.paid' | 'transfer.failed'; transferId: string; reason?: string }
  /** Evento que não muda nada na Domma (ex.: order.created): registrado e confirmado, sem efeito. */
  | { eventId: string; type: 'ignored'; note?: string };

export interface Address { zip: string; street: string; number: string; complement?: string; district: string; city: string; state: string }
export interface BankAccount { holderName: string; holderDocument: string; bank: string; branch: string; branchDigit?: string; account: string; accountDigit: string; type: 'checking' | 'savings' }

/** Dados cadastrais exigidos pelos gateways para abrir a subconta (Circular Bacen 3.978/20). */
export interface RecipientProfile {
  personType: 'pf' | 'pj';
  name: string; document: string; email: string; phone: string; address: Address;
  birthDate?: string; monthlyIncomeCents?: bigint; occupation?: string; motherName?: string; // PF
  tradingName?: string; annualRevenueCents?: bigint; // PJ
  partner?: { name: string; document: string; email: string; birthDate: string; monthlyIncomeCents: bigint; occupation: string };
  bankAccount?: BankAccount;
}

export interface GatewayAdapter {
  readonly name: string;
  /** Para onde vão os saques: chave Pix livre ou a conta bancária cadastrada na subconta. */
  readonly payoutMode: 'pix_key' | 'bank_account';
  /** Se o vendedor precisa ter subconta antes de vender (o gateway não guarda saldo de terceiros na conta da plataforma). */
  readonly requiresSubaccountToSell: boolean;
  /** Configuração pública que o navegador usa para tokenizar o cartão. */
  publicConfig(): { provider: string; publicKey: string | null; threeDS?: { scriptUrl: string } | null };
  /** Token de uso único para o navegador iniciar a autenticação 3-D Secure (gerado com a chave secreta). */
  threeDSToken?(): Promise<string>;
  createSubaccount(input: { workspaceId: string; name: string; document: string; profile?: RecipientProfile }): Promise<{ id: string }>;
  /** Troca a conta bancária de saque da subconta (modo bank_account). */
  updateBankAccount?(subaccountId: string, account: BankAccount): Promise<void>;
  /** Guarda um cartão tokenizado para cobranças futuras (assinaturas). Retorna a referência reutilizável. */
  saveCard?(input: { customer: CreateChargeInput['customer']; cardToken: string }): Promise<{ tokenRef: string; brand: string; last4: string }>;
  /** Consulta o estado de uma transferência, para gateways que não avisam por webhook. */
  getTransfer?(transferId: string): Promise<{ status: 'processing' | 'paid' | 'failed'; reason?: string }>;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  getCharge(chargeId: string): Promise<{ status: ChargeStatus; rawStatus: string } | null>;
  refund(input: { chargeId: string; amountCents: bigint; idempotencyKey: string }): Promise<{ refundId: string; status: 'processing' | 'done' }>;
  transfer(input: { subaccountId: string | null; pixKey?: string; amountCents: bigint; idempotencyKey: string }): Promise<{ transferId: string }>;
  /** Valida assinatura e normaliza o evento. Lança erro se a assinatura for inválida. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent;
  /** Extrato de liquidações do dia para conciliação (seção 5.4). */
  settlements(day: Date): Promise<{ chargeId: string; amountCents: bigint; type: 'credit' | 'debit' }[]>;
}

export const GATEWAY = Symbol('GATEWAY');
