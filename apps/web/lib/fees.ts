/** Espelho da RN-02..04 só para mostrar "A cada venda você recebe" (o servidor é a fonte da verdade). */
export function feeCents(price: number, method: 'pix' | 'card' = 'card') {
  if (price < 1000) return 199;
  const x = (price * 449) / 10000;
  const f = Math.floor(x), r = x - f;
  const rounded = r > 0.5 ? f + 1 : r < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  const fee = rounded + 149;
  return method === 'pix' ? Math.min(fee, 1490) : fee;
}
export const netCents = (price: number) => price - feeCents(price);
