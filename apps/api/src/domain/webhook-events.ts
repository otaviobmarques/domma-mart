/** Eventos que o produtor pode receber por webhook (5.8 / 22.7). */
export const WEBHOOK_EVENTS = ['order.created', 'order.paid', 'order.refunded', 'order.chargeback', 'pix.generated', 'boleto.generated', 'cart.abandoned', 'subscription.renewed', 'subscription.canceled', 'affiliate.commission'] as const;

/** Exemplo de cada evento (o mesmo formato enviado de verdade), para mapear campos no Zapier e no n8n. */
export function sampleEvent(type: string) {
  const base = { id: 'evt_exemplo123', type, created_at: '2026-11-11T12:00:00.000Z', test: true };
  const order = { order_id: '01933b7e-0000-7000-8000-000000000001', code: 'DM-AB12CD', amount: 19700, method: 'pix', customer: { name: 'Maria S.', email: 'm***@gmail.com' } };
  if (type.startsWith('subscription.')) return { ...base, data: { ...order, subscription_id: '01933b7e-0000-7000-8000-000000000002' } };
  if (type === 'cart.abandoned') return { ...base, data: { offer_id: '01933b7e-0000-7000-8000-000000000003', customer: { name: 'Maria S.', email: 'm***@gmail.com' } } };
  if (type === 'affiliate.commission') return { ...base, data: { ...order, commission: 7309 } };
  return { ...base, data: order };
}
