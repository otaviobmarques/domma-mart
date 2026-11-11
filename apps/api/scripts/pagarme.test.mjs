// Fluxo Pagar.me ponta a ponta contra uma API falsa da Pagar.me. Uso (API rodando com GATEWAY_PROVIDER=pagarme,
// PAGARME_API_URL=http://127.0.0.1:4230 e as chaves de teste abaixo): node scripts/pagarme.test.mjs
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
const API = process.env.API || 'http://localhost:4100';
const HOOK = 'Basic ' + Buffer.from('domma:senha-do-webhook-de-teste').toString('base64');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ───── Pagar.me falsa ─────
const calls = [];
const charges = {};
let seq = 0;
const run = Date.now().toString(36); // ids únicos por rodada (o banco pode já ter pedidos de rodadas anteriores)
const fake = http.createServer(async (req, res) => {
  let raw = ''; for await (const ch of req) raw += ch;
  const body = raw ? JSON.parse(raw) : null;
  const path = req.url.split('?')[0];
  calls.push({ method: req.method, path, body, auth: req.headers.authorization, idem: req.headers['idempotency-key'] });
  const send = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== 'Basic ' + Buffer.from('sk_test_e2e:').toString('base64')) return send(401, { message: 'Authorization has been denied' });
  if (req.method === 'POST' && path === '/core/v5/recipients') return send(200, { id: `rp_NOVO${++seq}`, status: 'registration' });
  if (req.method === 'POST' && path === '/core/v5/orders') {
    const p = body.payments[0];
    const id = `ch_${run}${++seq}`;
    if (p.payment_method === 'pix') { charges[id] = { status: 'pending', payment_method: 'pix' }; return send(200, { id: `or_${seq}`, charges: [{ id, status: 'pending', last_transaction: { qr_code: '00020101021226820014br.gov.bcb.pix2560pix.stone.com.br/teste', expires_at: p.pix.expires_at } }] }); }
    if (p.payment_method === 'credit_card') {
      const okCard = p.credit_card.card_token === 'token_aprovado';
      charges[id] = { status: okCard ? 'paid' : 'failed', payment_method: 'credit_card' };
      return send(200, { id: `or_${seq}`, customer: { id: 'cus_E2E' }, charges: [{ id, status: charges[id].status, last_transaction: okCard ? { status: 'captured', card: { id: 'card_E2E', last_four_digits: '1111', brand: 'Visa' } } : { status: 'not_authorized', acquirer_return_code: '51' } }] });
    }
  }
  if (req.method === 'GET' && path.startsWith('/core/v5/charges/')) { const c = charges[path.split('/').pop()]; return c ? send(200, { id: path.split('/').pop(), ...c }) : send(404, {}); }
  send(404, { message: 'rota não simulada' });
});
await new Promise(r => fake.listen(4230, '127.0.0.1', r));

// ───── Cliente da API ─────
const jar = {};
async function req(method, path, body, who, headers = {}) {
  const h = { 'content-type': 'application/json', 'x-requested-with': 'domma', ...headers };
  if (who && jar[who]) h.cookie = jar[who];
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (who && sc.length) jar[who] = [jar[who], ...sc.map(s => s.split(';')[0])].filter(Boolean).join('; ');
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
function totp(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out = [];
  for (const ch of secret) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hm = createHmac('sha1', Buffer.from(out)).update(buf).digest(); const o = hm[hm.length - 1] & 15;
  return String((((hm[o] & 127) << 24) | (hm[o + 1] << 16) | (hm[o + 2] << 8) | hm[o + 3]) % 1e6).padStart(6, '0');
}
const IMG = 'data:image/jpeg;base64,' + Buffer.from('foto').toString('base64');
const buyer = (n) => ({ name: 'Maria Souza', email: `maria.pgm.${n}.${Date.now()}@example.com`, phone: '(31) 99999-0000', document: '529.982.247-25' });

console.log('\n1) Nova produtora: sem recebedor não vende');
const email = `nova.${Date.now()}@example.com`;
const su = await req('POST', '/v1/auth/signup', { name: 'Carla Doceira', email, phone: '(31) 98888-7777', password: 'Doces@Carla2026', accept_terms: true }, 'nova');
ok(su.status === 201 || su.status === 200, 'cadastro da produtora');
const me0 = (await req('GET', '/v1/auth/me', null, 'nova')).body;
ok(me0.gateway === 'pagarme' && me0.payout_mode === 'bank_account' && me0.receiving_ready === false, 'painel sabe que o saque é para conta bancária e que ainda não pode vender');
const prod = await req('POST', '/v1/products', { type: 'service', name: 'Aula de Brigadeiro', price_cents: 10000 }, 'nova');
await req('PATCH', `/v1/products/${prod.body.product_id}`, { service_url: 'https://agenda.exemplo.com' }, 'nova');
const pub = await req('POST', `/v1/products/${prod.body.product_id}/publish`, {}, 'nova');
const slug = pub.body.checkout_url?.split('/').pop();
const offer = (await req('GET', `/v1/public/offers/${slug}`)).body;
ok(offer.gateway === 'pagarme' && offer.gateway_public_key === 'pk_test_e2e', 'checkout recebe a chave pública para tokenizar no navegador');
const blocked = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: buyer(0), method: 'pix' }, null, { 'idempotency-key': randomUUID() });
ok(blocked.status >= 400 && blocked.body.code === 'OFFER_UNAVAILABLE', 'sem recebedor na Pagar.me, a venda é bloqueada com mensagem clara');

console.log('\n2) Identidade com dados do Banco Central + conta bancária → recebedor');
const idBase = { person_type: 'pf', name: 'Carla Doceira', document: '390.533.447-05', birth_date: '1992-03-15', doc_front: IMG, selfie: IMG };
const noExtra = await req('POST', '/v1/identity', idBase, 'nova');
ok(noExtra.status === 422, 'sem endereço/renda a identidade é recusada (exigência do gateway)');
const extra = { phone: '31988887777', address: { zip: '30140-071', street: 'Rua da Bahia', number: '100', district: 'Centro', city: 'Belo Horizonte', state: 'mg' }, occupation: 'Confeiteira', monthly_income_cents: 450000 };
const kyc = await req('POST', '/v1/identity', { ...idBase, extra }, 'nova');
ok(kyc.status === 200 && kyc.body.status === 'in_review', 'identidade enviada com os dados completos');
ok(!calls.some(c => c.path === '/core/v5/recipients'), 'recebedor ainda não criado (falta a conta bancária)');
const pixTry = await req('PUT', '/v1/finance/payout-account', { pix_key: 'carla@example.com' }, 'nova', { 'x-otp': '000000' });
ok(pixTry.status === 422, 'chave Pix não é aceita quando o gateway transfere para conta bancária');
const s2 = (await req('POST', '/v1/auth/2fa/setup', {}, 'nova')).body;
await req('POST', '/v1/auth/2fa/enable', { code: totp(s2.secret) }, 'nova');
const badBank = await req('PUT', '/v1/finance/payout-account', { bank: { bank: '26', branch: '0001', account: '123', account_digit: '4', type: 'checking' } }, 'nova', { 'x-otp': totp(s2.secret) });
ok(badBank.status === 422, 'código do banco inválido é recusado');
const bank = await req('PUT', '/v1/finance/payout-account', { bank: { bank: '260', branch: '0001', account: '1234567', account_digit: '8', type: 'checking' } }, 'nova', { 'x-otp': totp(s2.secret) });
ok(bank.status === 200 && /Banco 260/.test(bank.body.pix_key_masked), 'conta bancária salva e mascarada');
const rec = calls.find(c => c.path === '/core/v5/recipients');
ok(!!rec, 'recebedor criado na Pagar.me');
ok(rec?.body.register_information.type === 'individual' && rec.body.register_information.birthdate === '15/03/1992' && rec.body.register_information.monthly_income === 450000, 'cadastro PF com nascimento e renda no formato da Pagar.me');
ok(rec?.body.register_information.address.state === 'MG' && rec.body.register_information.phone_numbers[0].ddd === '31', 'endereço e telefone repassados');
ok(rec?.body.default_bank_account.holder_document === '39053344705' && rec.body.default_bank_account.bank === '260', 'conta bancária no CPF da produtora');
ok(rec?.body.transfer_settings.transfer_enabled === false, 'sem repasse automático: o saque é pedido pela produtora');
const me1 = (await req('GET', '/v1/auth/me', null, 'nova')).body;
ok(me1.receiving_ready === true, 'painel libera as vendas');

console.log('\n3) Pix com split');
const o = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: buyer(1), method: 'pix' }, null, { 'idempotency-key': randomUUID() });
ok(o.status === 201 && o.body.next.type === 'pix', 'pedido Pix criado');
const ord = calls.filter(c => c.path === '/core/v5/orders').pop();
const split = ord?.body.payments[0].split ?? [];
const sum = split.reduce((s, r) => s + r.amount, 0);
ok(split.length === 2 && sum === o.body.total_cents, `split soma o total (${sum})`);
ok(split.find(r => r.recipient_id === 'rp_PLAT_E2E')?.options.charge_processing_fee === true, 'plataforma paga a taxa do gateway e responde por chargeback');
ok(split.some(r => /^rp_NOVO/.test(r.recipient_id) && r.amount > 0), 'parte da produtora vai para o recebedor dela');
ok(!!ord?.idem, 'pedido enviado com chave de idempotência');
const t = new URL('http://x' + o.body.next.url).searchParams.get('t');
const pix = (await req('GET', `/v1/orders/${o.body.order_id}/pix?t=${t}`)).body;
ok(pix.copy_paste?.startsWith('000201') && pix.qr?.startsWith('data:image/png'), 'QR Code gerado a partir do copia-e-cola da Pagar.me');

console.log('\n4) Webhook com autenticação básica + consulta ativa');
const chargeId = Object.keys(charges).find(k => charges[k].payment_method === 'pix');
const hook = (type, id, auth = HOOK) => fetch(API + '/webhooks/pagarme', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ id: `hook_${randomUUID()}`, type, data: { id } }) });
ok((await hook('charge.paid', chargeId, null)).status === 403, 'webhook sem credencial é recusado');
ok((await hook('charge.paid', chargeId, 'Basic ' + Buffer.from('domma:errada').toString('base64'))).status === 403, 'webhook com senha errada é recusado');
// consulta ativa ainda diz "pendente": o webhook não libera sozinho
await hook('charge.paid', chargeId);
await sleep(1500);
let st = (await req('GET', `/v1/orders/${o.body.order_id}?t=${t}`)).body;
ok(st.status !== 'paid', 'webhook de "pago" não libera enquanto a Pagar.me ainda diz pendente (RN-14)');
charges[chargeId].status = 'paid';
await hook('charge.paid', chargeId);
for (let i = 0; i < 20 && st.status !== 'paid'; i++) { await sleep(300); st = (await req('GET', `/v1/orders/${o.body.order_id}?t=${t}`)).body; }
ok(st.status === 'paid', 'pagamento confirmado depois da consulta ativa');
ok((await hook('order.created', 'or_1')).status === 200, 'evento sem efeito é aceito e ignorado');

console.log('\n5) Cartão tokenizado no navegador');
const c1 = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: buyer(2), method: 'card', installments: 2, card_token: 'token_aprovado' }, null, { 'idempotency-key': randomUUID() });
ok(c1.status === 201, 'cartão aprovado');
const cardCall = calls.filter(c => c.path === '/core/v5/orders').pop();
ok(cardCall?.body.payments[0].credit_card.card_token === 'token_aprovado' && !JSON.stringify(cardCall.body).includes('4111'), 'só o token vai para a Pagar.me — nunca o número');
const c2 = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: buyer(3), method: 'card', card_token: 'token_sem_limite' }, null, { 'idempotency-key': randomUUID() });
ok(c2.status === 402 && c2.body.code === 'CARD_INSUFFICIENT_FUNDS', 'recusa por saldo vira mensagem clara');

console.log('\n6) Saque');
const wd = await req('POST', '/v1/finance/withdrawals', { amount_cents: 1000 }, 'nova', { 'idempotency-key': randomUUID(), 'x-otp': totp(s2.secret) });
ok(wd.body.code === 'KYC_REQUIRED', 'antes da aprovação da identidade, não saca');

fake.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
