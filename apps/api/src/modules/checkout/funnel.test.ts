import { describe, it, expect } from 'vitest';
import { FunnelService, FUNNEL_WINDOW_MS } from './funnel.service';

const svc = new FunnelService({} as any, {} as any, {} as any, {} as any, {} as any) as any;
const base = (over: any = {}) => ({
  parent: { status: 'paid', paid_at: new Date(), parent_order_id: null, idempotency_key: 'co:abc', ...over.parent },
  children: over.children ?? [],
  declined: new Set(over.declined ?? []),
  offer: { upsell_offer_id: 'u', downsell_offer_id: 'd', ...over.offer },
});

describe('funil pós-compra: qual passo mostrar', () => {
  it('upsell logo depois do pagamento', () => expect(svc.currentStep(base())).toBe('upsell'));
  it('nada depois de 30 minutos', () => expect(svc.currentStep(base({ parent: { paid_at: new Date(Date.now() - FUNNEL_WINDOW_MS - 1000) } }))).toBeNull());
  it('nada se o pedido não foi pago', () => expect(svc.currentStep(base({ parent: { status: 'pending', paid_at: null } }))).toBeNull());
  it('pedido do funil não abre outro funil', () => expect(svc.currentStep(base({ parent: { parent_order_id: 'p' } }))).toBeNull());
  it('renovação de assinatura não abre funil', () => expect(svc.currentStep(base({ parent: { idempotency_key: 'renew:s:1' } }))).toBeNull());
  it('sem upsell configurado, nada', () => expect(svc.currentStep(base({ offer: { upsell_offer_id: null } }))).toBeNull());
  it('recusou o upsell → downsell', () => expect(svc.currentStep(base({ declined: ['upsell'] }))).toBe('downsell'));
  it('cartão recusado no upsell → downsell', () => expect(svc.currentStep(base({ children: [{ funnel_step: 'upsell', status: 'failed' }] }))).toBe('downsell'));
  it('aceitou o upsell → acabou', () => expect(svc.currentStep(base({ children: [{ funnel_step: 'upsell', status: 'paid' }] }))).toBeNull());
  it('recusou os dois → acabou', () => expect(svc.currentStep(base({ declined: ['upsell', 'downsell'] }))).toBeNull());
  it('recusou o upsell sem downsell → acabou', () => expect(svc.currentStep(base({ declined: ['upsell'], offer: { downsell_offer_id: null } }))).toBeNull());
});
