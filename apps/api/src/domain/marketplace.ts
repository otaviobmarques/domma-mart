import { computeFee, computeSplit } from './money';

/** Categorias da vitrine de afiliados. */
export const CATEGORIES: Record<string, string> = {
  negocios: 'Negócios e empreendedorismo', marketing: 'Marketing digital', financas: 'Finanças e investimentos',
  saude: 'Saúde e bem-estar', fitness: 'Fitness e esportes', culinaria: 'Culinária e gastronomia',
  desenvolvimento: 'Desenvolvimento pessoal', relacionamentos: 'Relacionamentos', educacao: 'Educação e concursos',
  idiomas: 'Idiomas', tecnologia: 'Tecnologia e programação', design: 'Design e fotografia',
  arte: 'Arte, música e artesanato', moda: 'Moda e beleza', casa: 'Casa e jardinagem', pets: 'Pets', outros: 'Outros',
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as [string, ...string[]];

/**
 * Quanto o afiliado ganha numa venda à vista: comissão sobre o valor depois da taxa
 * (venda por afiliado tem taxa própria), sem coprodutores — é a estimativa mostrada na vitrine.
 */
export function affiliateEarning(priceCents: bigint, bps: number, method: 'pix' | 'card' = 'pix'): bigint {
  const fee = computeFee({ baseCents: priceCents, method, viaAffiliate: true }).feeCents;
  const parts = computeSplit({ baseCents: priceCents, interestCents: 0n, absorbedCostCents: 0n, feeCents: fee, producerId: 'p', affiliate: { id: 'a', bps }, coproducers: [] });
  return parts.find(p => p.beneficiary_type === 'affiliate')?.amount_cents ?? 0n;
}

/** Temperatura 0–100: vendas pagas nos últimos 30 dias em escala logarítmica (1 venda ≈ 15, 100 ≈ 75, 1000+ = 100). */
export function temperature(sales30d: number): number {
  if (sales30d <= 0) return 0;
  return Math.min(100, Math.round(15 + 20 * Math.log10(sales30d) * 1.5));
}

/** Mostra só o primeiro nome e a inicial do sobrenome no ranking público (ex.: "Bruno S."). */
export function publicName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Afiliado';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
