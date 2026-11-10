/** Máquina de estados do pedido (seção 8.1). Única forma de mudar status: transition(). */
export type OrderStatus =
  | 'created' | 'pending' | 'paid' | 'refund_requested' | 'refunded'
  | 'chargeback' | 'chargeback_won' | 'chargeback_lost' | 'expired' | 'failed' | 'abandoned';

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ['pending', 'paid', 'failed', 'abandoned'],
  pending: ['paid', 'expired', 'failed'],
  paid: ['refund_requested', 'refunded', 'chargeback'],
  refund_requested: ['refunded', 'paid'],
  refunded: [],
  chargeback: ['chargeback_won', 'chargeback_lost'],
  chargeback_won: [],
  chargeback_lost: [],
  // Pix expirado pode gerar novo Pix no mesmo pedido (RN-13) e ainda ser pago.
  expired: ['pending', 'paid'],
  failed: ['pending', 'paid'],
  abandoned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Estados "à frente" de paid: eventos atrasados não podem regredir (RN-31). */
export const POST_PAID: OrderStatus[] = ['paid', 'refund_requested', 'refunded', 'chargeback', 'chargeback_won', 'chargeback_lost'];

/** Texto em linguagem simples para o painel (seção 4.2). */
export function statusLabel(s: OrderStatus): string {
  switch (s) {
    case 'paid': case 'chargeback_won': return 'Pago';
    case 'pending': case 'created': return 'Esperando o pagamento';
    case 'refunded': return 'Devolvido';
    case 'refund_requested': return 'Reembolso em andamento';
    case 'chargeback': return 'Em análise';
    case 'chargeback_lost': return 'Contestação perdida';
    case 'expired': return 'Não pago';
    case 'failed': return 'Recusado';
    case 'abandoned': return 'Abandonado';
  }
}
