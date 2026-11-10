/**
 * Regras financeiras puras (sem I/O). Valores SEMPRE em centavos inteiros (bigint).
 * Referências: RN-02..RN-10, RN-22, RN-35 (Descritivo Técnico v2.0, seção 20).
 */
export type Method = 'pix' | 'card' | 'boleto';

/** Divisão inteira com arredondamento "meia para o par" (banker's rounding). */
export function divRoundHalfEven(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error('den must be > 0');
  const neg = num < 0n;
  const n = neg ? -num : num;
  const q = n / den;
  const r = n % den;
  let out = q;
  if (r * 2n > den) out = q + 1n;
  else if (r * 2n === den) out = q % 2n === 0n ? q : q + 1n;
  return neg ? -out : out;
}

/** Aplica pontos-base (1 bp = 0,01%) com arredondamento meia-par. */
export function applyBps(amount: bigint, bps: number): bigint {
  return divRoundHalfEven(amount * BigInt(bps), 10_000n);
}

export const FEES = {
  directBps: 449, // 4,49% (RN-02)
  affiliateBps: 649, // 6,49% venda por afiliado (RN-02)
  tier50kBps: 399, // 3,99% acima de R$ 50 mil/30 dias (RN-05)
  fixedCents: 149n, // R$ 1,49
  pixCapCents: 1490n, // teto no Pix (RN-03)
  microThresholdCents: 1000n, // abaixo de R$ 10 (RN-04)
  microFixedCents: 199n,
  monthlyInterestBps: 299, // 2,99% a.m. (RN-07)
  minInstallmentCents: 500n, // RN-08
  minOrderCents: 500n, // RN-18 / RN-22
  maxOrderCents: 5_000_000n,
} as const;

export interface FeeInput {
  baseCents: bigint; // valor bruto da venda sem juros (oferta + bumps − cupom)
  method: Method;
  viaAffiliate: boolean;
  /** Percentual da faixa de volume ou negociado (RN-05), substitui o percentual padrão. */
  tierBps?: number | null;
}

export interface FeeResult {
  feeCents: bigint;
  rule: { bps: number | null; fixed: string; capped: boolean; micro: boolean };
}

/** Taxa Domma Mart por venda (RN-02, RN-03, RN-04, RN-05). */
export function computeFee(i: FeeInput): FeeResult {
  if (i.baseCents < FEES.microThresholdCents) {
    return { feeCents: FEES.microFixedCents, rule: { bps: null, fixed: '199', capped: false, micro: true } };
  }
  let bps: number = i.viaAffiliate ? FEES.affiliateBps : FEES.directBps;
  // Faixa de volume substitui o percentual (RN-02 final). Mantém o adicional do afiliado (+2pp).
  if (i.tierBps != null) bps = i.viaAffiliate ? i.tierBps + (FEES.affiliateBps - FEES.directBps) : i.tierBps;
  let fee = applyBps(i.baseCents, bps) + FEES.fixedCents;
  let capped = false;
  if (i.method === 'pix' && fee > FEES.pixCapCents) {
    fee = FEES.pixCapCents;
    capped = true;
  }
  return { feeCents: fee, rule: { bps, fixed: FEES.fixedCents.toString(), capped, micro: false } };
}

/** Faixa de volume pelo faturamento pago dos últimos 30 dias (RN-05). */
export function tierBpsFor(revenue30dCents: bigint, negotiatedBps?: number | null): number | null {
  if (revenue30dCents > 20_000_000n && negotiatedBps != null) return negotiatedBps;
  if (revenue30dCents > 5_000_000n) return FEES.tier50kBps;
  return null;
}

export interface InstallmentPlan {
  installments: number;
  installmentCents: bigint;
  totalCents: bigint;
  interestCents: bigint; // juros pagos pelo comprador
  absorbedCostCents: bigint; // custo de antecipação absorvido pelo produtor
  interestFree: boolean;
}

/**
 * Tabela Price a 2,99% a.m. a partir da 2ª parcela (RN-07).
 * Cálculo em ponto fixo (escala 1e12) para não depender de float em valores.
 */
export function priceInstallment(principal: bigint, n: number): bigint {
  if (n <= 1) return principal;
  const SCALE = 1_000_000_000_000n;
  const i = (BigInt(FEES.monthlyInterestBps) * SCALE) / 10_000n; // 0,0299 * SCALE
  let pow = SCALE; // (1+i)^n
  for (let k = 0; k < n; k++) pow = (pow * (SCALE + i)) / SCALE;
  // PMT = P * i * (1+i)^n / ((1+i)^n − 1)
  return divRoundHalfEven(principal * i * pow, (pow - SCALE) * SCALE);
}

export function installmentPlan(principal: bigint, n: number, mode: 'buyer' | 'producer'): InstallmentPlan {
  if (n < 1 || n > 12) throw new Error('installments must be 1..12');
  if (n === 1) {
    return { installments: 1, installmentCents: principal, totalCents: principal, interestCents: 0n, absorbedCostCents: 0n, interestFree: true };
  }
  const pmt = priceInstallment(principal, n);
  const withInterest = pmt * BigInt(n);
  const interest = withInterest - principal;
  if (mode === 'buyer') {
    return { installments: n, installmentCents: pmt, totalCents: withInterest, interestCents: interest, absorbedCostCents: 0n, interestFree: false };
  }
  // Produtor absorve: comprador paga o preço dividido; custo equivalente sai do produtor.
  return {
    installments: n,
    installmentCents: divRoundHalfEven(principal, BigInt(n)),
    totalCents: principal,
    interestCents: 0n,
    absorbedCostCents: interest,
    interestFree: true,
  };
}

/** Maior número de parcelas que respeita a parcela mínima de R$ 5,00 (RN-08). */
export function maxInstallmentsFor(principal: bigint, offerMax: number, mode: 'buyer' | 'producer'): number {
  let best = 1;
  for (let n = 2; n <= Math.min(12, offerMax); n++) {
    if (installmentPlan(principal, n, mode).installmentCents >= FEES.minInstallmentCents) best = n;
  }
  return best;
}

export function installmentOptions(principal: bigint, offerMax: number, mode: 'buyer' | 'producer') {
  const max = maxInstallmentsFor(principal, offerMax, mode);
  return Array.from({ length: max }, (_, k) => installmentPlan(principal, k + 1, mode));
}

export interface SplitInput {
  baseCents: bigint; // sem juros
  interestCents: bigint;
  absorbedCostCents: bigint;
  feeCents: bigint;
  producerId: string;
  affiliate?: { id: string; bps: number } | null;
  coproducers?: { id: string; bps: number }[];
}

export interface SplitPart {
  beneficiary_type: 'platform' | 'affiliate' | 'coproducer' | 'producer';
  beneficiary_id: string | null;
  amount_cents: bigint;
  rule: Record<string, unknown>;
}

/**
 * Divisão da venda (RN-09, RN-10): (1) taxa Domma; (2) afiliado sobre (base − taxa);
 * (3) sócios sobre o restante; (4) produtor fica com o resto (inclui centavos de arredondamento).
 * Juros do comprador vão para a plataforma (cobrem antecipação) e não entram em comissão.
 */
export function computeSplit(i: SplitInput): SplitPart[] {
  const parts: SplitPart[] = [];
  const platform = i.feeCents + i.interestCents + i.absorbedCostCents;
  parts.push({
    beneficiary_type: 'platform', beneficiary_id: null, amount_cents: platform,
    rule: { fee: i.feeCents.toString(), interest: i.interestCents.toString(), absorbed_cost: i.absorbedCostCents.toString() },
  });
  const afterFee = i.baseCents - i.feeCents;
  if (afterFee < 0n) throw new Error('fee greater than base');
  let remaining = afterFee;
  if (i.affiliate && i.affiliate.bps > 0) {
    const c = applyBps(afterFee, i.affiliate.bps);
    parts.push({ beneficiary_type: 'affiliate', beneficiary_id: i.affiliate.id, amount_cents: c, rule: { bps: i.affiliate.bps, base: afterFee.toString() } });
    remaining -= c;
  }
  const coproBase = remaining;
  for (const cp of i.coproducers ?? []) {
    const c = applyBps(coproBase, cp.bps);
    parts.push({ beneficiary_type: 'coproducer', beneficiary_id: cp.id, amount_cents: c, rule: { bps: cp.bps, base: coproBase.toString() } });
    remaining -= c;
  }
  const producer = remaining - i.absorbedCostCents;
  if (producer < 0n) throw new Error('producer share would be negative');
  parts.push({ beneficiary_type: 'producer', beneficiary_id: i.producerId, amount_cents: producer, rule: { remainder: true } });
  return parts;
}

/** Valor líquido por venda que o produtor vê ao digitar o preço (tela 19.8 / RN-02). */
export function netPerSale(priceCents: bigint, method: Method = 'card'): bigint {
  return priceCents - computeFee({ baseCents: priceCents, method, viaAffiliate: false }).feeCents;
}

const DAY = 86_400_000;

/** Cronograma de liberação do saldo (RN-35). Soma das parcelas = amount. */
export function releaseSchedule(amount: bigint, method: Method, paidAt: Date, guaranteeEndsAt: Date): { amount: bigint; availableAt: Date }[] {
  if (amount === 0n) return [];
  if (method === 'pix') {
    const first = applyBps(amount, 9_000);
    const out = [{ amount: first, availableAt: new Date(paidAt.getTime() + DAY) }];
    if (amount - first > 0n) out.push({ amount: amount - first, availableAt: guaranteeEndsAt });
    return out;
  }
  if (method === 'boleto') return [{ amount, availableAt: new Date(paidAt.getTime() + 2 * DAY) }];
  return [{ amount, availableAt: new Date(paidAt.getTime() + 30 * DAY) }];
}

/** Desconto de cupom (RN-20..22): só na oferta principal e total nunca < R$ 5,00. */
export function applyCoupon(mainCents: bigint, coupon: { kind: string; value: number } | null): bigint {
  if (!coupon) return 0n;
  let d = coupon.kind === 'percent' ? applyBps(mainCents, coupon.value) : BigInt(coupon.value);
  if (d > mainCents - FEES.minOrderCents) d = mainCents - FEES.minOrderCents;
  return d < 0n ? 0n : d;
}

export function formatBRL(cents: bigint | number): string {
  const v = Number(cents) / 100;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
