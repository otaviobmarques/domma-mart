// Teste ponta a ponta contra a API rodando (sandbox). Uso: node scripts/smoke.mjs
// Requer seed aplicado. Cobre: Pix com afiliado+cupom+bump, idempotência, webhook, ledger,
// matrícula, área do cliente, reembolso, cartão aprovado/recusado, saque com 2FA.
import { createHmac, randomUUID } from 'node:crypto';
const API = process.env.API || 'http://localhost:4000';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jar = {};
async function req(method, path, body, { cookie, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', 'x-requested-with': 'domma', ...headers };
  if (cookie && jar[cookie]) h.cookie = jar[cookie];
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (cookie && sc.length) jar[cookie] = [jar[cookie], ...sc.map(s => s.split(';')[0])].filter(Boolean).join('; ');
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, headers: r.headers };
}
function totp(secret) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out = [];
  for (const ch of secret) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', Buffer.from(out)).update(buf).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
const buyer = (n) => ({ name: 'Maria Souza', email: `maria.${n}.${Date.now()}@example.com`, phone: '(31) 99999-0000', document: '529.982.247-25' });
const cardToken = (num) => {
  const map = { '4000000000000002': 'decline', '4000000000009995': 'funds' };
  return 'tok_sbx_' + Buffer.from(JSON.stringify({ last4: num.slice(-4), brand: 'visa', scenario: map[num] ?? 'approve' })).toString('base64url');
};

console.log('\n1) Pix com afiliado, cupom e oferta especial');
const offer = (await req('GET', '/v1/public/offers/confeitaria')).body;
ok(offer.slug === 'confeitaria' && offer.bumps.length === 1, 'oferta pública com 1 oferta especial');
const coupon = await req('POST', '/v1/public/coupons/validate', { offer_id: offer.offer_id, code: 'bemvindo' });
ok(coupon.body.discount_cents === 1970, 'cupom BEMVINDO = 10% (R$ 19,70)');
const bad = await req('POST', '/v1/public/coupons/validate', { offer_id: offer.offer_id, code: 'NAOEXISTE' });
ok(bad.status === 422 && bad.body.code === 'COUPON_INVALID', 'cupom inválido → COUPON_INVALID');
const b1 = buyer(1);
const idem = randomUUID();
const body = { customer: b1, method: 'pix', bump_offer_ids: [offer.bumps[0].offer_id], coupon_code: 'BEMVINDO', affiliate_code: 'bruno', tracking: { utm_source: 'instagram' } };
const o1 = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, body, { headers: { 'idempotency-key': idem } });
ok(o1.status === 201 && o1.body.next.type === 'pix', 'pedido Pix criado (201, next=pix)');
ok(o1.body.total_cents === 19700 - 1970 + 2700, `total server-side = ${o1.body.total_cents} (oferta − cupom + bump)`);
const o1b = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, body, { headers: { 'idempotency-key': idem } });
ok(o1b.body.order_id === o1.body.order_id, 'mesma Idempotency-Key devolve o mesmo pedido (RN-30)');
const t = new URL('http://x' + o1.body.next.url).searchParams.get('t');
const pix = await req('GET', `/v1/orders/${o1.body.order_id}/pix?t=${t}`);
ok(pix.body.copy_paste?.startsWith('000201') && pix.body.qr?.startsWith('data:image/png'), 'QR Code e copia-e-cola gerados');
const forged = await req('GET', `/v1/orders/${o1.body.order_id}/pix?t=forjado.abc`);
ok(forged.status === 401, 'token de pedido forjado é recusado');
const fakeHook = await fetch(API + '/webhooks/sandbox', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sandbox-signature': 't=1,v1=00' }, body: JSON.stringify({ eventId: 'x', type: 'charge.paid', chargeId: pix.body.sandbox.charge_id }) });
ok(fakeHook.status === 403, 'webhook com assinatura inválida é recusado');
await req('POST', `/v1/dev/sandbox/orders/${o1.body.order_id}/pay`, { t });
let st;
for (let i = 0; i < 20; i++) { await sleep(300); st = (await req('GET', `/v1/orders/${o1.body.order_id}?t=${t}`)).body; if (st.status === 'paid') break; }
ok(st.status === 'paid', 'webhook do gateway confirmou → pedido pago');
ok(st.fire_purchase === true, 'evento Purchase disparado na 1ª abertura');
const again = (await req('GET', `/v1/orders/${o1.body.order_id}?t=${t}`)).body;
ok(again.fire_purchase === false, 'Purchase não dispara de novo ao recarregar');

console.log('\n2) Produtora: vendas, divisão e saldo');
const lp = await req('POST', '/v1/auth/login', { email: 'produtora@demo.com', password: 'Domma@Mart2026' }, { cookie: 'prod' });
ok(lp.status === 200, 'login da produtora');
const det = (await req('GET', `/v1/orders/${o1.body.order_id}/detail`, null, { cookie: 'prod' })).body;
const sum = det.splits.reduce((s, x) => s + x.amount_cents, 0);
ok(sum === det.total_cents, `divisão soma o total (${det.splits.map(s => s.type + ':' + s.amount_cents).join(', ')})`);
ok(det.splits.some(s => s.type === 'affiliate'), 'comissão do afiliado na divisão');
const fee = det.splits.find(s => s.type === 'platform').amount_cents;
ok(fee === Math.round(20430 * 0.0649) + 149, `taxa de venda por afiliado 6,49% + R$1,49 = ${fee}`);
const bal = (await req('GET', '/v1/finance/balance', null, { cookie: 'prod' })).body;
ok(bal.incoming_cents > 0, `saldo "Chegando" = ${bal.incoming_cents}`);
const csrf = await fetch(API + '/v1/products', { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar.prod }, body: '{}' });
ok(csrf.status === 403, 'POST sem X-Requested-With é bloqueado (CSRF)');

console.log('\n3) Área do cliente e reembolso');
await req('POST', '/v1/customer/auth/magic-link', { email: b1.email });
const outbox = (await req('GET', '/v1/dev/outbox')).body;
const link = outbox.find(n => n.template === 'magic_link')?.body.match(/token=([\w-]+)/)?.[1];
ok(!!link, 'link mágico enviado');
const v = await req('POST', '/v1/customer/auth/verify', { token: link }, { cookie: 'cust' });
ok(v.status === 200, 'entrou sem senha');
const reuse = await req('POST', '/v1/customer/auth/verify', { token: link });
ok(reuse.status === 401, 'link mágico é de uso único');
const pur = (await req('GET', '/v1/customer/purchases', null, { cookie: 'cust' })).body;
ok(pur.purchases[0]?.in_guarantee === true, 'compra aparece dentro da garantia');
const courses = (await req('GET', '/v1/members/courses', null, { cookie: 'cust' })).body;
ok(courses.length === 2, 'matrícula ativa no curso e no e-book (bump)');
const outline = (await req('GET', `/v1/members/products/${courses.find(c => c.type === 'course').id}`, null, { cookie: 'cust' })).body;
const lesson = outline.modules[0].lessons[0].id;
const pb = (await req('GET', `/v1/members/lessons/${lesson}/playback`, null, { cookie: 'cust' })).body;
ok(pb.watermark?.includes(b1.email), 'aula com marca d’água do aluno');
const rf = await req('POST', `/v1/customer/orders/${o1.body.order_id}/refund`, { reason: 'not_expected' }, { cookie: 'cust', headers: { 'idempotency-key': randomUUID() } });
ok(rf.status === 202, 'reembolso pedido em 1 clique');
await sleep(500);
const after = (await req('GET', '/v1/customer/purchases', null, { cookie: 'cust' })).body;
ok(after.purchases[0].status === 'refunded', 'pedido reembolsado');
const noAccess = await req('GET', `/v1/members/lessons/${lesson}/playback`, null, { cookie: 'cust' });
ok(noAccess.status === 403, 'acesso revogado após reembolso (RN-33)');
const bal2 = (await req('GET', '/v1/finance/balance', null, { cookie: 'prod' })).body;
ok(bal2.incoming_cents < bal.incoming_cents, 'saldo "Chegando" revertido');

console.log('\n4) Cartão');
const c1 = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: buyer(2), method: 'card', installments: 3, card_token: cardToken('4111111111111111') }, { headers: { 'idempotency-key': randomUUID() } });
ok(c1.status === 201 && c1.body.installments === 3, `cartão 3x aceito (total ${c1.body.total_cents} com juros)`);
const c2 = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: buyer(3), method: 'card', card_token: cardToken('4000000000009995') }, { headers: { 'idempotency-key': randomUUID() } });
ok(c2.status === 402 && c2.body.code === 'CARD_INSUFFICIENT_FUNDS', 'cartão sem limite → mensagem clara (tabela 23)');
const bogus = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: { ...buyer(4), document: '111.111.111-11' }, method: 'pix' }, { headers: { 'idempotency-key': randomUUID() } });
ok(bogus.status === 422 && bogus.body.code === 'CPF_INVALID', 'CPF inválido → CPF_INVALID');
const t2 = new URL('http://x' + c1.body.next.url).searchParams.get('t');
let s2; for (let i = 0; i < 20; i++) { await sleep(300); s2 = (await req('GET', `/v1/orders/${c1.body.order_id}?t=${t2}`)).body; if (s2.status === 'paid') break; }
ok(s2.status === 'paid', 'cartão confirmado por webhook');

console.log('\n5) Saque com 2FA');
const secret = process.env.PROD_TOTP;
if (!secret) console.log('  (defina PROD_TOTP com o segredo impresso no seed para testar o saque)');
else {
  const noOtp = await req('POST', '/v1/finance/withdrawals', { amount_cents: 1000 }, { cookie: 'prod', headers: { 'idempotency-key': randomUUID() } });
  ok(noOtp.status === 422 && noOtp.body.code === 'OTP_INVALID', 'saque sem código 2FA é recusado');
  const tooMuch = await req('POST', '/v1/finance/withdrawals', { amount_cents: 999999999 }, { cookie: 'prod', headers: { 'idempotency-key': randomUUID(), 'x-otp': totp(secret) } });
  ok(tooMuch.body.code === 'INSUFFICIENT_BALANCE', 'saque acima do disponível → INSUFFICIENT_BALANCE');
}

console.log('\n6) Ajuste manual de saldo com 2 aprovadores (RN-38)');
const la = await req('POST', '/v1/auth/login', { email: 'admin@dommamart.com', password: 'Domma@Mart2026' }, { cookie: 'adm' });
const lf = await req('POST', '/v1/auth/login', { email: 'financeiro@dommamart.com', password: 'Domma@Mart2026' }, { cookie: 'fin' });
if (la.status !== 200 || lf.status !== 200) { ok(false, 'login do admin e do financeiro'); }
else {
  const me = (await req('GET', '/v1/auth/me', null, { cookie: 'prod' })).body;
  const before = (await req('GET', '/v1/finance/balance', null, { cookie: 'prod' })).body;
  const short = await req('POST', '/v1/admin/adjustments', { workspace_id: me.workspace.id, amount_cents: 1234, reason: 'curto' }, { cookie: 'adm' });
  ok(short.status === 422, 'ajuste sem motivo suficiente é recusado');
  const a = await req('POST', '/v1/admin/adjustments', { workspace_id: me.workspace.id, amount_cents: 1234, reason: 'Teste automatizado: crédito de cortesia por instabilidade' }, { cookie: 'adm' });
  ok(a.status === 201 && a.body.status === 'pending', 'pedido de ajuste criado como pendente');
  const self = await req('POST', `/v1/admin/adjustments/${a.body.id}/approve`, {}, { cookie: 'adm' });
  ok(self.status === 403, 'quem pediu não consegue aprovar o próprio ajuste');
  const mid = (await req('GET', '/v1/finance/balance', null, { cookie: 'prod' })).body;
  ok(mid.available_cents - mid.negative_cents === before.available_cents - before.negative_cents, 'saldo não muda enquanto o ajuste está pendente');
  const ap = await req('POST', `/v1/admin/adjustments/${a.body.id}/approve`, { note: 'Conferido' }, { cookie: 'fin' });
  ok(ap.status === 200 && ap.body.status === 'approved' && ap.body.transaction_id, 'outra pessoa do Financeiro aprova');
  const again = await req('POST', `/v1/admin/adjustments/${a.body.id}/approve`, {}, { cookie: 'fin' });
  ok(again.status === 422, 'ajuste já aprovado não é lançado duas vezes');
  const after = (await req('GET', '/v1/finance/balance', null, { cookie: 'prod' })).body;
  ok((after.available_cents - after.negative_cents) - (before.available_cents - before.negative_cents) === 1234, 'saldo da produtora sobe exatamente R$ 12,34');
  const rec = (await req('GET', '/v1/admin/reconciliation', null, { cookie: 'fin' })).body;
  ok(rec.balanced === true, 'livro-razão continua balanceado (débitos = créditos)');
  const aud = (await req('GET', `/v1/admin/audit?target=workspace:${me.workspace.id}`, null, { cookie: 'adm' })).body;
  ok(aud.chain.ok && aud.rows.some(r => r.action === 'ledger_adjustment.approve') && aud.rows.some(r => r.action === 'ledger_adjustment.request'), 'pedido e aprovação na auditoria com cadeia íntegra');
}
console.log(`\n${pass} ok, ${fail} falhas\n`);
process.exit(fail ? 1 : 0);
