import { describe, it, expect, beforeEach } from 'vitest';
import { PagarmeGateway, parseCardRef } from './pagarme.adapter';
import type { CreateChargeInput } from './gateway.types';

const ENV = {
  PAGARME_SECRET_KEY: 'sk_test_abc', PAGARME_PUBLIC_KEY: 'pk_test_abc', PAGARME_PLATFORM_RECIPIENT_ID: 'rp_PLATAFORMA',
  PAGARME_WEBHOOK_USER: 'domma', PAGARME_WEBHOOK_PASSWORD: 'senha-bem-longa-123',
};

type Call = { method: string; url: string; headers: Record<string, string>; body: any };
function fakeFetch(reply: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any) => {
    const c = { method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const customer = { name: 'Maria Souza', email: 'maria@exemplo.com', document: '529.982.247-25', phone: '+5531999998888' };
const base: CreateChargeInput = {
  idempotencyKey: 'charge:1', orderId: '0190f0f0-0000-7000-8000-000000000001', method: 'pix', amountCents: 10_000n, installments: 1,
  description: 'Curso de Confeitaria', customer, pixExpiresAt: new Date('2026-11-11T12:30:00Z'),
  split: [
    { kind: 'platform', subaccountId: null, amountCents: 990n },
    { kind: 'affiliate', subaccountId: 'rp_AFILIADO', amountCents: 2_000n },
    { kind: 'producer', subaccountId: 'rp_PRODUTOR', amountCents: 7_010n },
  ],
};

describe('PagarmeGateway', () => {
  beforeEach(() => { Object.assign(process.env, ENV); });

  it('recusa subir sem as variáveis obrigatórias', () => {
    delete process.env.PAGARME_PLATFORM_RECIPIENT_ID;
    expect(() => new PagarmeGateway()).toThrow(/PAGARME_PLATFORM_RECIPIENT_ID/);
  });

  it('split em valor fixo: plataforma assume taxa, chargeback e resto', () => {
    const g = new PagarmeGateway();
    const rules = g.splitRules(base.split, 10_000n)!;
    expect(rules.reduce((s, r) => s + r.amount, 0n)).toBe(10_000n);
    const plat = rules.find(r => r.recipient_id === 'rp_PLATAFORMA')!;
    expect(plat.amount).toBe(990n);
    expect(plat.options).toEqual({ liable: true, charge_processing_fee: true, charge_remainder_fee: true });
    expect(rules.find(r => r.recipient_id === 'rp_PRODUTOR')!.options.liable).toBe(false);
    expect(rules.every(r => r.type === 'flat')).toBe(true);
  });

  it('sem outro recebedor, não manda split', () => {
    const g = new PagarmeGateway();
    expect(g.splitRules([{ kind: 'platform', subaccountId: null, amountCents: 500n }], 500n)).toBeUndefined();
  });

  it('cria Pix com chave secreta, idempotência e devolve QR próprio', async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: 'or_1', charges: [{ id: 'ch_1', status: 'pending', last_transaction: { qr_code: '00020126580014BR.GOV.BCB.PIX', expires_at: '2026-11-11T12:30:00Z' } }] } }));
    const r = await new PagarmeGateway(f).createCharge(base);
    expect(r).toMatchObject({ chargeId: 'ch_1', status: 'pending', pix: { copyPaste: '00020126580014BR.GOV.BCB.PIX' } });
    expect(r.pix!.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const c = calls[0];
    expect(c.method).toBe('POST');
    expect(c.url).toBe('https://api.pagar.me/core/v5/orders');
    expect(c.headers.authorization).toBe('Basic ' + Buffer.from('sk_test_abc:').toString('base64'));
    expect(c.headers['idempotency-key']).toBe('charge:1');
    expect(c.body.payments[0]).toMatchObject({ payment_method: 'pix', pix: { expires_at: '2026-11-11T12:30:00.000Z' } });
    expect(c.body.payments[0].split).toHaveLength(3);
    expect(c.body.customer).toMatchObject({ document: '52998224725', document_type: 'CPF', type: 'individual', phones: { mobile_phone: { area_code: '31', number: '999998888' } } });
    expect(c.body.items[0].amount).toBe(10_000);
  });

  it('cartão: token do navegador, aprovação vira "authorized" com referência reutilizável', async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: 'or_2', customer: { id: 'cus_ABC' }, charges: [{ id: 'ch_2', status: 'paid', last_transaction: { status: 'captured', card: { id: 'card_XYZ', last_four_digits: '1111', brand: 'Visa' } } }] } }));
    const r = await new PagarmeGateway(f).createCharge({ ...base, method: 'card', installments: 3, cardToken: 'token_abc123' });
    expect(r).toMatchObject({ status: 'authorized', card: { brand: 'visa', last4: '1111', tokenRef: 'pgm:cus_ABC:card_XYZ' } });
    expect(calls[0].body.payments[0].credit_card).toMatchObject({ card_token: 'token_abc123', installments: 3, operation_type: 'auth_and_capture' });
    expect(calls[0].body.payments[0].credit_card.card).toBeUndefined();
  });

  it('cartão recusado por saldo vira código amigável; token inválido nem chega ao gateway', async () => {
    const { f, calls } = fakeFetch(() => ({ json: { charges: [{ id: 'ch_3', status: 'failed', last_transaction: { status: 'not_authorized', acquirer_return_code: '51' } }] } }));
    const g = new PagarmeGateway(f);
    expect((await g.createCharge({ ...base, method: 'card', cardToken: 'token_x' })).declineCode).toBe('CARD_INSUFFICIENT_FUNDS');
    expect((await g.createCharge({ ...base, method: 'card', cardToken: 'tok_sbx_falso' })).status).toBe('declined');
    expect(calls).toHaveLength(1);
  });

  it('renovação usa o cartão guardado (customer_id + card_id)', async () => {
    const { f, calls } = fakeFetch(() => ({ json: { charges: [{ id: 'ch_4', status: 'paid', last_transaction: { status: 'captured' } }] } }));
    await new PagarmeGateway(f).createCharge({ ...base, method: 'card', savedCardRef: 'pgm:cus_ABC:card_XYZ', split: [] });
    expect(calls[0].body.customer_id).toBe('cus_ABC');
    expect(calls[0].body.customer).toBeUndefined();
    expect(calls[0].body.payments[0].credit_card).toMatchObject({ card_id: 'card_XYZ', recurrence_cycle: 'subsequent' });
    expect(parseCardRef('pgm:cus_A:card_B')).toEqual({ customerId: 'cus_A', cardId: 'card_B' });
    expect(parseCardRef('card_sbx_x')).toBeNull();
  });

  it('reembolso parcial cancela só o valor pedido', async () => {
    const { f, calls } = fakeFetch(() => ({ json: { id: 'ch_1', status: 'paid', last_transaction: { id: 'tran_9', status: 'refunded' } } }));
    const r = await new PagarmeGateway(f).refund({ chargeId: 'ch_1', amountCents: 2_500n, idempotencyKey: 'refund:1' });
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'https://api.pagar.me/core/v5/charges/ch_1', body: { amount: 2500 } });
    expect(r).toEqual({ refundId: 'tran_9', status: 'done' });
  });

  it('saque: transferência do recebedor e consulta de estado', async () => {
    const { f, calls } = fakeFetch(c => ({ json: c.method === 'POST' ? { id: 777, status: 'pending_transfer' } : { id: 777, status: 'transferred' } }));
    const g = new PagarmeGateway(f);
    await expect(g.transfer({ subaccountId: null, amountCents: 1n, idempotencyKey: 'x' })).rejects.toThrow();
    expect(await g.transfer({ subaccountId: 'rp_PRODUTOR', amountCents: 5_000n, idempotencyKey: 'wd:1' })).toEqual({ transferId: '777' });
    expect(calls[0].body).toMatchObject({ amount: 5000, recipient_id: 'rp_PRODUTOR' });
    expect(await g.getTransfer('777')).toEqual({ status: 'paid' });
  });

  it('recebedor PF: cadastro completo com conta bancária e sem repasse automático', () => {
    const body = new PagarmeGateway().recipientBody('ws-1', {
      personType: 'pf', name: 'Ana Confeiteira', document: '52998224725', email: 'ana@exemplo.com', phone: '+5531999998888',
      address: { zip: '30140071', street: 'Rua da Bahia', number: '100', district: 'Centro', city: 'Belo Horizonte', state: 'mg' },
      birthDate: '1990-05-20', monthlyIncomeCents: 500_000n, occupation: 'Confeiteira',
      bankAccount: { holderName: 'Ana Confeiteira', holderDocument: '52998224725', bank: '260', branch: '0001', account: '1234567', accountDigit: '8', type: 'checking' },
    });
    expect(body.register_information).toMatchObject({ type: 'individual', birthdate: '20/05/1990', monthly_income: 500000, professional_occupation: 'Confeiteira', address: { state: 'MG', zip_code: '30140071', complementary: 'N/A' }, phone_numbers: [{ ddd: '31', number: '999998888' }] });
    expect(body.default_bank_account).toMatchObject({ holder_type: 'individual', holder_document: '52998224725', bank: '260', account_check_digit: '8', type: 'checking' });
    expect(body.transfer_settings.transfer_enabled).toBe(false);
  });

  it('webhook: exige autenticação básica e normaliza os eventos', () => {
    const g = new PagarmeGateway();
    const auth = { authorization: 'Basic ' + Buffer.from('domma:senha-bem-longa-123').toString('base64') };
    const raw = (o: unknown) => Buffer.from(JSON.stringify(o));
    expect(() => g.parseWebhook({}, raw({ id: 'hook_1', type: 'charge.paid', data: { id: 'ch_1' } }))).toThrow();
    expect(() => g.parseWebhook({ authorization: 'Basic ' + Buffer.from('domma:errada').toString('base64') }, raw({ id: 'hook_1' }))).toThrow();
    expect(g.parseWebhook(auth, raw({ id: 'hook_1', type: 'charge.paid', data: { id: 'ch_1' } }))).toEqual({ eventId: 'hook_1', type: 'charge.paid', chargeId: 'ch_1' });
    expect(g.parseWebhook(auth, raw({ id: 'hook_2', type: 'charge.payment_failed', data: { id: 'ch_2', payment_method: 'pix' } })).type).toBe('charge.expired');
    expect(g.parseWebhook(auth, raw({ id: 'hook_3', type: 'chargeback.received', data: { charge: { id: 'ch_3' } } }))).toMatchObject({ type: 'charge.chargeback', chargeId: 'ch_3' });
    expect(g.parseWebhook(auth, raw({ id: 'hook_4', type: 'order.created', data: {} })).type).toBe('ignored');
  });
});
