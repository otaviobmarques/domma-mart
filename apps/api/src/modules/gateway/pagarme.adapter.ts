import { Logger } from '@nestjs/common';
import { pixQrDataUrl } from './qr';
import { GatewayAdapter, CreateChargeInput, ChargeResult, GatewayEvent, ChargeStatus, RecipientProfile, BankAccount, Address, SplitRule } from './gateway.types';
import { safeEqual } from '../../common/crypto';
import { onlyDigits } from '../../domain/validators';

/**
 * Gateway Pagar.me (API v5 — https://docs.pagar.me). Modelo marketplace:
 *  - cada produtor, afiliado e coprodutor é um recebedor (`rp_…`) com conta bancária própria;
 *  - o split vai na autorização, em valores fixos (centavos), e a plataforma (PAGARME_PLATFORM_RECIPIENT_ID)
 *    assume taxas, chargeback e o resto dos arredondamentos;
 *  - o cartão é tokenizado no navegador com a chave pública (POST /tokens?appId=pk_…), então o número
 *    nunca chega à API da Domma (P4/RN-63);
 *  - webhooks chegam com autenticação básica (usuário e senha configurados no painel) e a confirmação
 *    de pagamento ainda é conferida por consulta ativa (RN-14, ver jobs.service);
 *  - transferências não têm webhook: o job `transfers.poll` consulta o estado.
 *
 * Variáveis: PAGARME_SECRET_KEY (sk_…), PAGARME_PUBLIC_KEY (pk_…), PAGARME_PLATFORM_RECIPIENT_ID (rp_…),
 * PAGARME_WEBHOOK_USER e PAGARME_WEBHOOK_PASSWORD. Opcional: PAGARME_API_URL, PAGARME_STATEMENT (até 13 letras).
 */
export class PagarmeGateway implements GatewayAdapter {
  readonly name = 'pagarme';
  readonly payoutMode = 'bank_account' as const;
  readonly requiresSubaccountToSell = true;
  private log = new Logger('Pagarme');
  private base = (process.env.PAGARME_API_URL || 'https://api.pagar.me/core/v5').replace(/\/$/, '');
  private sk = process.env.PAGARME_SECRET_KEY || '';
  private pk = process.env.PAGARME_PUBLIC_KEY || '';
  private platform = process.env.PAGARME_PLATFORM_RECIPIENT_ID || '';
  private hookUser = process.env.PAGARME_WEBHOOK_USER || '';
  private hookPass = process.env.PAGARME_WEBHOOK_PASSWORD || '';
  private statement = (process.env.PAGARME_STATEMENT || 'DOMMA').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13);
  /** 3-D Secure (Stone 3DS 2.x): PAGARME_3DS=on liga; o ambiente segue a chave (sk_test_ → sandbox). */
  private threeDSOn = process.env.PAGARME_3DS === 'on';
  private threeDSLive = (process.env.PAGARME_3DS_ENV || (this.sk.startsWith('sk_test_') ? 'sandbox' : 'production')) === 'production';
  private threeDSApi = process.env.PAGARME_3DS_API_URL || (this.threeDSLive ? 'https://3ds.stone.com.br/v2' : 'https://3ds-sdx.stone.com.br/v2');

  constructor(private fetchImpl: typeof fetch = fetch) {
    const missing = [['PAGARME_SECRET_KEY', this.sk], ['PAGARME_PUBLIC_KEY', this.pk], ['PAGARME_PLATFORM_RECIPIENT_ID', this.platform], ['PAGARME_WEBHOOK_USER', this.hookUser], ['PAGARME_WEBHOOK_PASSWORD', this.hookPass]].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`Pagar.me: faltam as variáveis ${missing.join(', ')}`);
    if (this.hookPass.length < 16) throw new Error('Pagar.me: PAGARME_WEBHOOK_PASSWORD precisa de pelo menos 16 caracteres');
  }

  publicConfig() {
    return { provider: 'pagarme', publicKey: this.pk, threeDS: this.threeDSOn ? { scriptUrl: `https://3ds-nx-js.stone.com.br/${this.threeDSLive ? 'live' : 'test'}/v2/3ds2.min.js` } : null };
  }

  async threeDSToken() {
    if (!this.threeDSOn) throw new Error('3-D Secure desligado');
    const r = await this.fetchImpl(`${this.threeDSApi}/tds-token`, { headers: { authorization: 'Basic ' + Buffer.from(`${this.sk}:`).toString('base64') }, signal: AbortSignal.timeout(10_000) });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j?.tds_token) throw new PagarmeError(r.status, `3DS token → ${r.status}`);
    return String(j.tds_token);
  }

  // ───────── HTTP ─────────
  private async call<T = any>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { authorization: 'Basic ' + Buffer.from(`${this.sk}:`).toString('base64'), accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey.slice(0, 64);
    const r = await this.fetchImpl(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)), signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* resposta não JSON */ }
    if (!r.ok) {
      const detail = json?.message || json?.errors ? JSON.stringify({ message: json?.message, errors: json?.errors }).slice(0, 500) : text.slice(0, 200);
      throw new PagarmeError(r.status, `${method} ${path} → ${r.status} ${detail}`);
    }
    return json as T;
  }

  // ───────── Mapeamentos ─────────
  private customer(c: CreateChargeInput['customer']) {
    const doc = onlyDigits(c.document);
    const phone = onlyDigits(c.phone).replace(/^55(?=\d{10,11}$)/, '');
    return {
      name: c.name.slice(0, 64), email: c.email.slice(0, 64), document: doc, document_type: doc.length === 14 ? 'CNPJ' : 'CPF', type: doc.length === 14 ? 'company' : 'individual',
      phones: phone.length >= 10 ? { mobile_phone: { country_code: '55', area_code: phone.slice(0, 2), number: phone.slice(2) } } : undefined,
    };
  }

  private address(a: Address) {
    return { country: 'BR', state: a.state.toUpperCase().slice(0, 2), city: a.city, zip_code: onlyDigits(a.zip), line_1: `${a.number}, ${a.street}, ${a.district}`.slice(0, 256), line_2: a.complement || undefined };
  }

  /** Regras de split em valor fixo. A plataforma fica com taxas, chargeback e o resto. */
  splitRules(split: SplitRule[], total: bigint) {
    const byRecipient = new Map<string, bigint>();
    for (const s of split) {
      if (s.amountCents <= 0n) continue;
      const rid = s.subaccountId || this.platform;
      byRecipient.set(rid, (byRecipient.get(rid) ?? 0n) + s.amountCents);
    }
    // ninguém além da plataforma? então não há split — tudo cai na conta principal
    if (![...byRecipient.keys()].some(k => k !== this.platform)) return undefined;
    const others = [...byRecipient].filter(([k]) => k !== this.platform);
    const othersSum = others.reduce((s, [, v]) => s + v, 0n);
    if (othersSum > total) throw new Error('split maior que o valor da cobrança');
    const rules = others.map(([recipient_id, amount]) => ({ recipient_id, amount, type: 'flat', options: { liable: false, charge_processing_fee: false, charge_remainder_fee: false } }));
    const platformAmount = total - othersSum;
    if (platformAmount > 0n) rules.push({ recipient_id: this.platform, amount: platformAmount, type: 'flat', options: { liable: true, charge_processing_fee: true, charge_remainder_fee: true } });
    else rules[0].options = { liable: true, charge_processing_fee: true, charge_remainder_fee: true };
    return rules;
  }

  private static status(raw: string, method?: string): ChargeStatus {
    switch (raw) {
      case 'paid': case 'overpaid': return 'paid';
      case 'pending': case 'processing': case 'underpaid': return 'pending';
      case 'failed': case 'not_authorized': return method === 'pix' || method === 'boleto' ? 'expired' : 'declined';
      case 'canceled': return 'refunded';
      case 'chargedback': return 'refunded';
      default: return 'pending';
    }
  }

  /** Códigos de recusa (acquirer_return_code) → códigos da Domma (mensagens amigáveis no checkout). */
  private static decline(code?: string, antifraud?: string): string {
    if (antifraud === 'reproved') return 'CARD_RISK_BLOCKED';
    switch (code) {
      case '51': case '1016': return 'CARD_INSUFFICIENT_FUNDS';
      case '54': case '1001': return 'CARD_EXPIRED';
      case '82': case '1045': case 'N7': return 'CARD_CVV_INVALID';
      default: return 'CARD_DECLINED';
    }
  }

  // ───────── Contrato ─────────
  async createCharge(i: CreateChargeInput): Promise<ChargeResult> {
    const payment: any = { payment_method: i.method === 'card' ? 'credit_card' : i.method, split: this.splitRules(i.split, i.amountCents) };
    if (i.method === 'pix') payment.pix = { expires_at: i.pixExpiresAt!.toISOString() };
    else if (i.method === 'boleto') payment.boleto = { due_at: i.boletoDueAt!.toISOString(), instructions: 'Não receber após o vencimento.', document_number: i.orderId.replace(/-/g, '').slice(0, 16) };
    else {
      const cc: any = { installments: i.installments, statement_descriptor: this.statement, operation_type: 'auth_and_capture' };
      let customerId: string | undefined;
      if (i.savedCardRef) {
        const ref = parseCardRef(i.savedCardRef);
        if (!ref) throw new Error('referência de cartão inválida');
        cc.card_id = ref.cardId; customerId = ref.customerId;
        if (i.cardOnFile !== 'one_click') cc.recurrence_cycle = 'subsequent'; // renovação de assinatura (iniciada pela loja)
      } else {
        if (!i.cardToken?.startsWith('token_')) return { chargeId: `pgm_invalid_${i.orderId}`, status: 'declined', rawStatus: 'INVALID_TOKEN', declineCode: 'CARD_DECLINED' };
        cc.card_token = i.cardToken;
        if (i.billingAddress) cc.card = { billing_address: this.address(i.billingAddress) };
        if (i.threeDS) cc.authentication = { type: 'threed_secure', threed_secure: { mpi: 'pagarme', transaction_id: i.threeDS.transactionId.slice(0, 256) } };
      }
      payment.credit_card = cc;
      if (customerId) return this.mapOrder(await this.call('POST', '/orders', this.orderBody(i, payment, customerId), i.idempotencyKey), i);
    }
    return this.mapOrder(await this.call('POST', '/orders', this.orderBody(i, payment), i.idempotencyKey), i);
  }

  private orderBody(i: CreateChargeInput, payment: any, customerId?: string) {
    return {
      code: i.orderId.slice(0, 52), closed: true,
      items: [{ code: 'domma', description: i.description.slice(0, 250), amount: i.amountCents, quantity: 1 }],
      ...(customerId ? { customer_id: customerId } : { customer: this.customer(i.customer) }),
      payments: [payment], metadata: { domma_order_id: i.orderId },
    };
  }

  private async mapOrder(o: any, i: CreateChargeInput): Promise<ChargeResult> {
    const ch = o?.charges?.[0];
    if (!ch?.id) throw new Error('Pagar.me não devolveu a cobrança');
    const tx = ch.last_transaction ?? {};
    const raw = String(ch.status || tx.status || 'pending');
    if (i.method === 'pix') {
      if (!tx.qr_code) throw new Error(`Pix não gerado (${raw})`);
      return { chargeId: ch.id, status: 'pending', rawStatus: raw.toUpperCase(), pix: { copyPaste: tx.qr_code, qrDataUrl: await pixQrDataUrl(tx.qr_code), expiresAt: tx.expires_at ? new Date(tx.expires_at) : i.pixExpiresAt! } };
    }
    if (i.method === 'boleto') {
      if (!tx.line && !tx.pdf) throw new Error(`Boleto não gerado (${raw})`);
      return { chargeId: ch.id, status: 'pending', rawStatus: raw.toUpperCase(), boleto: { url: tx.pdf || tx.url, line: tx.line, dueAt: tx.due_at ? new Date(tx.due_at) : i.boletoDueAt! } };
    }
    const card = tx.card ?? ch.card;
    const customerId = ch.customer?.id ?? o.customer?.id;
    const base = { chargeId: ch.id, rawStatus: raw.toUpperCase(), card: card ? { brand: String(card.brand || 'card').toLowerCase(), last4: card.last_four_digits, tokenRef: card.id && customerId ? `pgm:${customerId}:${card.id}` : undefined } : undefined };
    const score = Number(tx.antifraud_response?.score);
    const riskScore = Number.isFinite(score) ? Math.round(score) : undefined;
    // pago na hora = autorizado; a confirmação definitiva chega por webhook (charge.paid) e é conferida por consulta
    if (raw === 'paid' || tx.status === 'captured' || tx.status === 'authorized_pending_capture') return { ...base, status: 'authorized', riskScore };
    if (raw === 'pending' || raw === 'processing') return { ...base, status: 'pending', riskScore };
    return { ...base, status: 'declined', declineCode: PagarmeGateway.decline(tx.acquirer_return_code, tx.antifraud_response?.status), riskScore };
  }

  async getCharge(chargeId: string) {
    try {
      const ch = await this.call('GET', `/charges/${encodeURIComponent(chargeId)}`);
      return { status: PagarmeGateway.status(ch.status, ch.payment_method), rawStatus: String(ch.status).toUpperCase() };
    } catch (e) {
      if (e instanceof PagarmeError && e.status === 404) return null;
      throw e;
    }
  }

  async refund(i: { chargeId: string; amountCents: bigint; idempotencyKey: string }) {
    const ch = await this.call('DELETE', `/charges/${encodeURIComponent(i.chargeId)}`, { amount: i.amountCents }, i.idempotencyKey);
    const done = ch?.status === 'canceled' || ch?.last_transaction?.status === 'refunded';
    return { refundId: ch?.last_transaction?.id ?? `${i.chargeId}:${i.idempotencyKey}`, status: done ? ('done' as const) : ('processing' as const) };
  }

  async transfer(i: { subaccountId: string | null; amountCents: bigint; idempotencyKey: string }) {
    if (!i.subaccountId) throw new Error('saque exige recebedor na Pagar.me');
    const t = await this.call('POST', '/transfers', { amount: i.amountCents, recipient_id: i.subaccountId, metadata: { idempotency_key: i.idempotencyKey } }, i.idempotencyKey);
    return { transferId: String(t.id) };
  }

  async getTransfer(transferId: string) {
    const t = await this.call('GET', `/transfers/${encodeURIComponent(transferId)}`);
    if (t.status === 'transferred') return { status: 'paid' as const };
    if (t.status === 'failed' || t.status === 'canceled') return { status: 'failed' as const, reason: t.status === 'canceled' ? 'Transferência cancelada' : 'Transferência recusada pelo banco' };
    return { status: 'processing' as const };
  }

  private bank(a: BankAccount) {
    const doc = onlyDigits(a.holderDocument);
    return {
      holder_name: a.holderName.slice(0, 30), holder_type: doc.length === 14 ? 'company' : 'individual', holder_document: doc,
      bank: a.bank.padStart(3, '0'), branch_number: a.branch, branch_check_digit: a.branchDigit || undefined,
      account_number: a.account, account_check_digit: a.accountDigit, type: a.type,
    };
  }

  private static phone(p: string) {
    const d = onlyDigits(p).replace(/^55(?=\d{10,11}$)/, '');
    return { ddd: d.slice(0, 2), number: d.slice(2), type: 'mobile' };
  }

  private static addr(a: Address) {
    return { street: a.street, complementary: a.complement || 'N/A', street_number: a.number, neighborhood: a.district, city: a.city, state: a.state.toUpperCase().slice(0, 2), zip_code: onlyDigits(a.zip), reference_point: 'N/A' };
  }

  /** Corpo de criação do recebedor (contrato de fev/2024, Circular 3.978). */
  recipientBody(workspaceId: string, p: RecipientProfile) {
    if (!p.bankAccount) throw new Error('recebedor sem conta bancária');
    const doc = onlyDigits(p.document);
    const reg = p.personType === 'pf'
      ? {
          type: 'individual', name: p.name, email: p.email, document: doc, birthdate: toBRDate(p.birthDate!), mother_name: p.motherName || undefined,
          monthly_income: Number(p.monthlyIncomeCents ?? 0n), professional_occupation: p.occupation, phone_numbers: [PagarmeGateway.phone(p.phone)], address: PagarmeGateway.addr(p.address),
        }
      : {
          type: 'corporation', company_name: p.tradingName || p.name, trading_name: p.name, email: p.email, document: doc, annual_revenue: Number(p.annualRevenueCents ?? 0n),
          phone_numbers: [PagarmeGateway.phone(p.phone)], main_address: PagarmeGateway.addr(p.address),
          managing_partners: p.partner ? [{
            name: p.partner.name, email: p.partner.email, document: onlyDigits(p.partner.document), type: 'individual', birthdate: toBRDate(p.partner.birthDate),
            monthly_income: Number(p.partner.monthlyIncomeCents), professional_occupation: p.partner.occupation, self_declared_legal_representative: true,
            address: PagarmeGateway.addr(p.address), phone_numbers: [PagarmeGateway.phone(p.phone)],
          }] : [],
        };
    return {
      code: workspaceId, register_information: reg, default_bank_account: this.bank(p.bankAccount),
      transfer_settings: { transfer_enabled: false }, // saque só quando o produtor pede (RN-36/37)
      automatic_anticipation_settings: { enabled: false },
    };
  }

  async createSubaccount(i: { workspaceId: string; profile?: RecipientProfile }) {
    if (!i.profile) throw new Error('Pagar.me exige os dados cadastrais completos do recebedor');
    const r = await this.call('POST', '/recipients', this.recipientBody(i.workspaceId, i.profile));
    const id = r?.id ?? r?.recipient_id ?? r?.payment_profile_id;
    if (!id) throw new Error('Pagar.me não devolveu o id do recebedor');
    return { id: String(id) };
  }

  async updateBankAccount(subaccountId: string, account: BankAccount) {
    await this.call('PATCH', `/recipients/${encodeURIComponent(subaccountId)}/default-bank-account`, { bank_account: this.bank(account) });
  }

  async saveCard(i: { customer: CreateChargeInput['customer']; cardToken: string }) {
    if (!i.cardToken.startsWith('token_')) throw new Error('token inválido');
    const cus = await this.call('POST', '/customers', this.customer(i.customer));
    const card = await this.call('POST', `/customers/${encodeURIComponent(cus.id)}/cards`, { token: i.cardToken });
    return { tokenRef: `pgm:${cus.id}:${card.id}`, brand: String(card.brand || 'card').toLowerCase(), last4: card.last_four_digits };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, raw: Buffer): GatewayEvent {
    const auth = String(headers['authorization'] || '');
    const expected = 'Basic ' + Buffer.from(`${this.hookUser}:${this.hookPass}`).toString('base64');
    if (!auth || !safeEqual(auth, expected)) throw new Error('invalid credentials');
    const body = JSON.parse(raw.toString());
    const eventId = String(body.id || '');
    if (!eventId) throw new Error('evento sem id');
    const d = body.data ?? {};
    const chargeId = String(d.charge?.id ?? d.charge_id ?? d.id ?? '');
    switch (body.type) {
      case 'charge.paid': return { eventId, type: 'charge.paid', chargeId };
      case 'charge.payment_failed': return { eventId, type: d.payment_method === 'credit_card' ? 'charge.declined' : 'charge.expired', chargeId };
      case 'charge.refunded': return { eventId, type: 'charge.refunded', chargeId };
      case 'charge.chargedback': case 'chargeback.received': return { eventId, type: 'charge.chargeback', chargeId };
      default: return { eventId, type: 'ignored', note: String(body.type || '') };
    }
  }

  /** Conciliação: a Pagar.me não tem extrato diário da conta principal pela API pública; a conferência é por webhook + consulta ativa. */
  async settlements() { return []; }
}

export class PagarmeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function parseCardRef(ref: string): { customerId: string; cardId: string } | null {
  const m = /^pgm:(cus_[A-Za-z0-9]+):(card_[A-Za-z0-9]+)$/.exec(ref);
  return m ? { customerId: m[1], cardId: m[2] } : null;
}

/** AAAA-MM-DD → DD/MM/AAAA (formato pedido nos recebedores). */
function toBRDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
