import { Logger } from '@nestjs/common';
import { pixQrDataUrl } from './qr';
import { createHmac } from 'node:crypto';
import { GatewayAdapter, CreateChargeInput, ChargeResult, GatewayEvent, ChargeStatus } from './gateway.types';
import { redis } from '../../infra/redis';
import { base62, safeEqual } from '../../common/crypto';
import { brCode } from './brcode';

/**
 * Gateway SANDBOX: simula o comportamento de um gateway com subcontas e split, para
 * desenvolvimento e testes ponta a ponta sem dinheiro real. Confirmações chegam sempre
 * por webhook assinado (RN-14), como num provedor real.
 *
 * Cartões de teste (tokenizados no navegador pelo sandbox-tokenizer):
 *   4111 1111 1111 1111 → aprovado      4000 0000 0000 0002 → recusado
 *   4000 0000 0000 9995 → sem limite    4000 0000 0000 0069 → vencido
 *   4000 0000 0000 0127 → CVV inválido  4000 0000 0000 4954 → risco alto
 */
export class SandboxGateway implements GatewayAdapter {
  readonly name = 'sandbox';
  readonly payoutMode = 'pix_key' as const;
  readonly requiresSubaccountToSell = false;
  publicConfig() { return { provider: 'sandbox', publicKey: null }; }
  private log = new Logger('SandboxGateway');
  private secret = process.env.GATEWAY_WEBHOOK_SECRET || 'sandbox_whsec_dev';
  private selfUrl = `http://127.0.0.1:${process.env.API_PORT || 4000}/webhooks/sandbox`;

  async saveCard(i: { cardToken: string }) {
    const tok = parseSandboxToken(i.cardToken);
    if (!tok) throw new Error('token inválido');
    return { tokenRef: sandboxRef(tok), brand: tok.brand, last4: tok.last4 };
  }

  async createSubaccount(i: { workspaceId: string }) { return { id: `acc_sbx_${i.workspaceId.slice(0, 8)}${base62(6)}` }; }

  private async save(id: string, data: Record<string, string>) { await redis().hset(`sbx:charge:${id}`, data); }

  async createCharge(i: CreateChargeInput): Promise<ChargeResult> {
    const idemKey = `sbx:idem:${i.idempotencyKey}`;
    const existing = await redis().get(idemKey);
    if (existing) return JSON.parse(existing, (_k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));
    const chargeId = `ch_sbx_${base62(14)}`;
    let result: ChargeResult;

    if (i.method === 'pix') {
      const copyPaste = brCode({ txid: chargeId, amountCents: i.amountCents, merchant: 'DOMMA MART', city: 'BELO HORIZONTE' });
      const qrDataUrl = await pixQrDataUrl(copyPaste);
      result = { chargeId, status: 'pending', rawStatus: 'PENDING', pix: { qrDataUrl, copyPaste, expiresAt: i.pixExpiresAt! } };
      await this.save(chargeId, { status: 'pending', method: 'pix', amount: String(i.amountCents), expires: String(i.pixExpiresAt!.getTime()) });
    } else if (i.method === 'boleto') {
      const line = `23793.38128 6${Date.now().toString().slice(-4)}.${String(i.amountCents).padStart(6, '0')} 4${base62(4).replace(/\D/g, '0')}0.000000 1 ${String(i.amountCents).padStart(14, '0')}`;
      result = { chargeId, status: 'pending', rawStatus: 'PENDING', boleto: { url: `/v1/dev/sandbox/boleto/${chargeId}.pdf`, line, dueAt: i.boletoDueAt! } };
      await this.save(chargeId, { status: 'pending', method: 'boleto', amount: String(i.amountCents), line });
    } else {
      const tok = parseSandboxToken(i.cardToken) ?? parseSandboxRef(i.savedCardRef);
      if (!tok) {
        result = { chargeId, status: 'declined', rawStatus: 'INVALID_TOKEN', declineCode: 'CARD_DECLINED' };
      } else {
        const map: Record<string, [ChargeStatus, string | undefined, number]> = {
          approve: ['authorized', undefined, 12], decline: ['declined', 'CARD_DECLINED', 40], funds: ['declined', 'CARD_INSUFFICIENT_FUNDS', 20],
          expired: ['declined', 'CARD_EXPIRED', 10], cvv: ['declined', 'CARD_CVV_INVALID', 30], risk: ['declined', 'CARD_RISK_BLOCKED', 95],
        };
        const [status, declineCode, risk] = map[tok.scenario] ?? map.approve;
        result = { chargeId, status, rawStatus: status.toUpperCase(), declineCode, riskScore: risk, card: { brand: tok.brand, last4: tok.last4, tokenRef: sandboxRef(tok) } };
        if (status === 'authorized') {
          await this.save(chargeId, { status: 'authorized', method: 'card', amount: String(i.amountCents) });
          // confirmação definitiva chega depois, por webhook (seção 8.2, passo 6)
          setTimeout(() => this.emit({ type: 'charge.paid', chargeId }).catch(() => {}), 800);
        }
      }
    }
    await redis().set(idemKey, JSON.stringify(result), 'EX', 86400);
    return result;
  }

  async getCharge(chargeId: string) {
    const c = await redis().hgetall(`sbx:charge:${chargeId}`);
    if (!c.status) return null;
    return { status: c.status as ChargeStatus, rawStatus: c.status.toUpperCase() };
  }

  async refund(i: { chargeId: string }) {
    await redis().hset(`sbx:charge:${i.chargeId}`, { status: 'refunded' });
    return { refundId: `rf_sbx_${base62(10)}`, status: 'done' as const };
  }

  async transfer(i: { pixKey?: string; amountCents: bigint }) {
    const transferId = `tr_sbx_${base62(12)}`;
    // chave de teste "falha@teste.com" simula falha na transferência (seção 8.4, passo 4)
    const fail = (i.pixKey ?? '').toLowerCase().includes('falha');
    setTimeout(() => this.emit(fail ? { type: 'transfer.failed', transferId, reason: 'Chave Pix não encontrada' } : { type: 'transfer.paid', transferId }).catch(() => {}), 1500);
    return { transferId };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, raw: Buffer): GatewayEvent {
    const sig = String(headers['x-sandbox-signature'] || '');
    const [tPart, vPart] = sig.split(',');
    const t = Number(tPart?.replace('t=', ''));
    const expected = createHmac('sha256', this.secret).update(`${t}.${raw.toString()}`).digest('hex');
    if (!t || !vPart || !safeEqual(vPart.replace('v1=', ''), expected)) throw new Error('invalid signature');
    if (Math.abs(Date.now() - t * 1000) > 5 * 60_000) throw new Error('stale webhook');
    return JSON.parse(raw.toString());
  }

  async settlements() { return []; }

  /** Envia um webhook assinado para a própria API, como o gateway faria. */
  async emit(ev: Omit<GatewayEvent, 'eventId'> & Record<string, unknown>) {
    if (ev.type === 'charge.paid' && 'chargeId' in ev) {
      const c = await redis().hgetall(`sbx:charge:${ev.chargeId}`);
      if (c.method === 'pix' && Number(c.expires) < Date.now()) throw new Error('Pix expirado não pode ser pago');
      await redis().hset(`sbx:charge:${ev.chargeId}`, { status: 'paid' });
    }
    const body = JSON.stringify({ eventId: `evt_sbx_${base62(16)}`, ...ev });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', this.secret).update(`${t}.${body}`).digest('hex');
    const r = await fetch(this.selfUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sandbox-signature': `t=${t},v1=${sig}` }, body });
    if (!r.ok) this.log.warn(`webhook sandbox → ${r.status}`);
    return body;
  }
}

/** Token gerado no navegador pelo tokenizador do sandbox. Nunca contém o número completo. */
export function parseSandboxToken(t?: string): { last4: string; brand: string; scenario: string } | null {
  if (!t?.startsWith('tok_sbx_')) return null;
  try { return JSON.parse(Buffer.from(t.slice(8), 'base64url').toString()); } catch { return null; }
}

/** Referência de cartão guardado no sandbox: carrega bandeira e final (o número completo nunca existe aqui). */
export function sandboxRef(t: { last4: string; brand: string }) { return `card_sbx_${Buffer.from(JSON.stringify({ last4: t.last4, brand: t.brand })).toString('base64url')}`; }
function parseSandboxRef(r?: string): { last4: string; brand: string; scenario: string } | null {
  if (!r?.startsWith('card_sbx_')) return null;
  try { return { ...JSON.parse(Buffer.from(r.slice(9), 'base64url').toString()), scenario: 'approve' }; } catch { return { last4: '0000', brand: 'card', scenario: 'approve' }; }
}
