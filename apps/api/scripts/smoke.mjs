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
/** Login com verificação em duas etapas: senha → pede código → senha + código. */
async function login(email, password, jarName, secret) {
  const a = await req('POST', '/v1/auth/login', { email, password }, { cookie: jarName });
  if (a.status !== 200 || !a.body.needs_otp) return a;
  if (!secret) return { status: 0, body: { needs_otp: true } };
  return req('POST', '/v1/auth/login', { email, password, otp: totp(secret) }, { cookie: jarName });
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
ok(pix.body.copy_paste?.startsWith('000201') && pix.body.qr?.startsWith('data:image/svg+xml'), 'QR Code e copia-e-cola gerados');
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
const lp0 = await req('POST', '/v1/auth/login', { email: 'produtora@demo.com', password: 'Domma@Mart2026' }, { cookie: 'p0' });
ok(lp0.status === 200 && lp0.body.needs_otp === true && !jar.p0?.includes('dm_session'), 'com 2FA ativa, só a senha não abre a sessão');
if (process.env.PROD_TOTP) {
  const bad2 = await req('POST', '/v1/auth/login', { email: 'produtora@demo.com', password: 'Domma@Mart2026', otp: totp(process.env.PROD_TOTP) === '000000' ? '111111' : '000000' }, { cookie: 'p0' });
  ok(bad2.status === 422 && bad2.body.code === 'OTP_INVALID' && !jar.p0?.includes('dm_session'), 'código errado é recusado');
}
const lp = await login('produtora@demo.com', 'Domma@Mart2026', 'prod', process.env.PROD_TOTP);
ok(lp.status === 200 && lp.body.ok === true, 'login da produtora com senha + código');
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
const la = await login('admin@dommamart.com', process.env.ADMIN_PASSWORD || 'Domma@Mart2026', 'adm', process.env.ADMIN_TOTP);
const lf = await login('financeiro@dommamart.com', 'Domma@Mart2026', 'fin', process.env.FIN_TOTP);
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

console.log('\n7) Login por usuário e regra de senha');
const adminPw = process.env.ADMIN_PASSWORD || 'Domma@Mart2026';
ok((await req('POST', '/v1/auth/login', { email: 'Admin', password: adminPw })).body.needs_otp === true, 'back-office aceita o usuário "Admin" (e pede o código do aplicativo)');
ok((await req('POST', '/v1/auth/login', { email: 'admin', password: adminPw })).body.needs_otp === true, 'usuário não diferencia maiúsculas');
const noOtpAdmin = await req('POST', '/v1/auth/login', { email: 'Admin', password: adminPw }, { cookie: 'admx' });
ok((await req('GET', '/v1/admin/overview', null, { cookie: 'admx' })).status === 401, 'back-office não abre só com a senha');
ok((await req('POST', '/v1/auth/login', { email: 'Admin', password: 'senha-errada' })).status === 401, 'senha errada com usuário é recusada');
const su = (pw) => req('POST', '/v1/auth/signup', { name: 'Teste Senha', email: `senha.${pw.length}.${Date.now()}@example.com`, phone: '(31) 99999-0000', password: pw, accept_terms: true });
const s8 = await su('Ab#45678');
ok(s8.status === 422 && s8.body.code === 'WEAK_PASSWORD', 'senha de 8 caracteres é recusada');
ok((await su('Ab#456789')).status === 201, 'senha de 9 caracteres é aceita');
console.log('\n8) Compra com 1 clique (cartão guardado + código no e-mail)');
const b9 = buyer(9);
const first = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: b9, method: 'card', card_token: cardToken('4111111111111111'), save_card: true }, { headers: { 'idempotency-key': randomUUID() } });
ok(first.status === 201, 'compra no cartão com "guardar cartão" marcado');
const silent = await req('POST', '/v1/public/one-click/start', { email: `ninguem.${Date.now()}@example.com` });
ok(silent.status === 200 && /Se este e-mail/.test(silent.body.message), 'e-mail sem cartão recebe a mesma resposta (não revela quem é cliente)');
await req('POST', '/v1/public/one-click/start', { email: b9.email.toUpperCase() });
const ob = (await req('GET', '/v1/dev/outbox')).body;
const ocCode = ob.find(n => n.template === 'one_click_code')?.body.match(/(\d{6})/)?.[1];
ok(!!ocCode, 'código de 6 números enviado por e-mail');
const wrong = await req('POST', '/v1/public/one-click/verify', { email: b9.email, code: ocCode === '000000' ? '111111' : '000000' });
ok(wrong.status === 422 && wrong.body.code === 'OTP_INVALID', 'código errado é recusado');
const ver = await req('POST', '/v1/public/one-click/verify', { email: b9.email, code: ocCode });
ok(ver.status === 200 && ver.body.cards?.length === 1 && ver.body.cards[0].last4 === '1111' && ver.body.first_name === 'Maria', 'código certo mostra o cartão guardado (só bandeira e final)');
ok(!JSON.stringify(ver.body).includes('card_sbx_'), 'referência do cartão no gateway não sai da API');
ok((await req('POST', '/v1/public/one-click/verify', { email: b9.email, code: ocCode })).status === 422, 'código é de uso único');
const one = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { method: 'card', installments: 2, one_click: { token: ver.body.token, card_id: ver.body.cards[0].id } }, { headers: { 'idempotency-key': randomUUID() } });
ok(one.status === 201 && one.body.installments === 2, 'compra com 1 clique sem digitar dados nem cartão');
const t9 = new URL('http://x' + one.body.next.url).searchParams.get('t');
let s9; for (let i = 0; i < 20; i++) { await sleep(300); s9 = (await req('GET', `/v1/orders/${one.body.order_id}?t=${t9}`)).body; if (s9.status === 'paid') break; }
ok(s9.status === 'paid', 'compra com 1 clique confirmada');
const forgedOc = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { method: 'card', one_click: { token: ver.body.token.slice(0, -2) + 'xx', card_id: ver.body.cards[0].id } }, { headers: { 'idempotency-key': randomUUID() } });
ok(forgedOc.status >= 400 && forgedOc.body.code === 'AUTH_LINK_EXPIRED', 'sessão de 1 clique adulterada é recusada');
const noCard = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: buyer(10), method: 'card' }, { headers: { 'idempotency-key': randomUUID() } });
ok(noCard.status === 422, 'cartão sem token nem 1 clique é recusado');
// área do comprador: ver e remover cartão (LGPD)
await req('POST', '/v1/customer/auth/magic-link', { email: b9.email });
const ob2 = (await req('GET', '/v1/dev/outbox')).body;
const ml = ob2.find(n => n.template === 'magic_link' && n.to?.toLowerCase?.() === b9.email)?.body.match(/token=([\w-]+)/)?.[1] ?? ob2.find(n => n.template === 'magic_link')?.body.match(/token=([\w-]+)/)?.[1];
await req('POST', '/v1/customer/auth/verify', { token: ml }, { cookie: 'c9' });
const myCards = (await req('GET', '/v1/customer/cards', null, { cookie: 'c9' })).body;
ok(Array.isArray(myCards) && myCards.length === 1, 'comprador vê o cartão guardado em Minhas compras');
ok((await req('DELETE', `/v1/customer/cards/${myCards[0]?.id}`, null, { cookie: 'c9' })).status === 200, 'comprador remove o cartão');
const after9 = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { method: 'card', one_click: { token: ver.body.token, card_id: ver.body.cards[0].id } }, { headers: { 'idempotency-key': randomUUID() } });
ok(after9.status === 422, 'cartão removido não pode mais ser usado');

console.log('\n9) Portal LGPD: baixar dados e pedir exclusão');
const loginCustomer = async (email, jarName) => {
  await req('POST', '/v1/customer/auth/magic-link', { email });
  const ob = (await req('GET', '/v1/dev/outbox')).body;
  const tk = ob.find(n => n.template === 'magic_link')?.body.match(/token=([\w-]+)/)?.[1];
  return (await req('POST', '/v1/customer/auth/verify', { token: tk }, { cookie: jarName })).status === 200;
};
// comprador com compra paga (b1, do passo 1)
ok(await loginCustomer(b1.email, 'lg1'), 'comprador entra na área de compras');
const exp = await fetch(API + '/v1/customer/privacy/export', { headers: { 'x-requested-with': 'domma', cookie: jar.lg1 } });
const expJson = await exp.json();
ok(exp.status === 200 && /attachment/.test(exp.headers.get('content-disposition') || ''), 'baixa os próprios dados como arquivo');
ok(expJson.dados_pessoais?.email === b1.email && expJson.compras?.length >= 1 && expJson.dados_pessoais.documento === '52998224725', 'arquivo traz dados pessoais e compras');
ok((await fetch(API + '/v1/customer/privacy/export', { headers: { 'x-requested-with': 'domma' } })).status === 401, 'sem login não baixa nada');
const del1 = await req('POST', '/v1/customer/privacy/requests', { kind: 'deletion' }, { cookie: 'lg1' });
ok(del1.status === 201 && del1.body.status === 'scheduled' && del1.body.retain_until, 'com compra paga: exclusão programada para o fim do prazo legal');
ok(/cartões guardados/.test(del1.body.resolution) && /obrigação legal/.test(del1.body.resolution), 'resposta explica o que saiu na hora e o que fica guardado');
const del1b = await req('POST', '/v1/customer/privacy/requests', { kind: 'deletion' }, { cookie: 'lg1' });
ok(del1b.body.id === del1.body.id, 'pedido repetido não duplica');
ok((await req('GET', '/v1/customer/privacy/requests', null, { cookie: 'lg1' })).body.length >= 1, 'comprador acompanha os pedidos');
// comprador sem compra paga: anonimizado na hora
const bx = buyer(11);
await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: bx, method: 'pix' }, { headers: { 'idempotency-key': randomUUID() } });
ok(await loginCustomer(bx.email, 'lg2'), 'comprador sem compra paga entra');
const del2 = await req('POST', '/v1/customer/privacy/requests', { kind: 'deletion' }, { cookie: 'lg2' });
ok(del2.body.status === 'done', 'sem compra paga: dados apagados na hora');
ok((await req('GET', '/v1/customer/purchases', null, { cookie: 'lg2' })).status === 401, 'sessão encerrada depois da exclusão');
const relog = await loginCustomer(bx.email, 'lg3');
ok(!relog, 'e-mail apagado não entra mais (dados anonimizados)');
// produtor
const pexp = await fetch(API + '/v1/privacy/export', { headers: { 'x-requested-with': 'domma', cookie: jar.prod } });
const pj = await pexp.json();
ok(pexp.status === 200 && pj.dados_pessoais?.email === 'produtora@demo.com' && Array.isArray(pj.verificacoes_de_identidade), 'produtor baixa os próprios dados');
const corr = await req('POST', '/v1/privacy/requests', { kind: 'correction', details: 'Meu nome está sem acento' }, { cookie: 'prod' });
ok(corr.status === 201 && corr.body.status === 'pending', 'pedido de correção vai para a equipe');
const pdel = await req('POST', '/v1/privacy/requests', { kind: 'deletion' }, { cookie: 'prod' });
ok(pdel.body.status === 'pending', 'exclusão de produtor vai para a equipe');
if (la.status === 200) {
  const q = (await req('GET', '/v1/admin/privacy?status=pending', null, { cookie: 'adm' })).body;
  ok(Array.isArray(q) && q.some(r => r.id === pdel.body.id) && q.find(r => r.id === pdel.body.id).subject.email.includes('***'), 'back-office vê a fila (e-mail mascarado)');
  const blocked = await req('POST', `/v1/admin/privacy/${pdel.body.id}/decision`, { decision: 'done', resolution: 'Conta encerrada a pedido.' }, { cookie: 'adm' });
  ok(blocked.status === 422 && /saldo/.test(blocked.body.title), 'não encerra conta com saldo ou valores a liberar');
  ok((await req('POST', `/v1/admin/privacy/${corr.body.id}/decision`, { decision: 'done', resolution: 'Nome corrigido no cadastro.' }, { cookie: 'adm' })).body.status === 'done', 'correção respondida');
  ok((await req('GET', '/v1/admin/privacy', null, { cookie: 'prod' })).status === 403, 'produtor não acessa a fila da equipe');
}
console.log('\n10) Conta do comprador não pode ser tomada pelo checkout');
const victim = buyer(20);
const vo = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: victim, method: 'pix' }, { headers: { 'idempotency-key': randomUUID() } });
ok(vo.status === 201, 'vítima tem cadastro de comprador');
// invasor usa o e-mail da vítima com o próprio telefone e outro CPF
const atk = { ...victim, name: 'Invasor Teste', phone: '(31) 98765-4321', document: '390.533.447-05' };
const ao = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: atk, method: 'pix' }, { headers: { 'idempotency-key': randomUUID() } });
ok(ao.status === 201, 'checkout com e-mail de outra pessoa ainda funciona (a compra é de quem paga)');
const before10 = (await req('GET', '/v1/dev/outbox')).body.filter(n => n.template === 'otp_code').length;
await req('POST', '/v1/customer/auth/otp', { phone: atk.phone });
const after10 = (await req('GET', '/v1/dev/outbox')).body.filter(n => n.template === 'otp_code').length;
ok(after10 === before10, 'telefone do invasor não foi gravado na conta da vítima (nenhum código enviado)');
const at = new URL('http://x' + ao.body.next.url).searchParams.get('t');
await req('POST', `/v1/dev/sandbox/orders/${ao.body.order_id}/pay`, { t: at });
let th; for (let i = 0; i < 20; i++) { await sleep(300); th = (await req('GET', `/v1/orders/${ao.body.order_id}?t=${at}`)).body; if (th.status === 'paid') break; }
ok(th.status === 'paid' && th.login_token === null && th.access_by_email === true, 'pedido pago com e-mail de conta existente não dá login direto (acesso só pelo link do e-mail)');
const fresh = buyer(21);
const fo = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: fresh, method: 'pix' }, { headers: { 'idempotency-key': randomUUID() } });
const ft = new URL('http://x' + fo.body.next.url).searchParams.get('t');
await req('POST', `/v1/dev/sandbox/orders/${fo.body.order_id}/pay`, { t: ft });
let fth; for (let i = 0; i < 20; i++) { await sleep(300); fth = (await req('GET', `/v1/orders/${fo.body.order_id}?t=${ft}`)).body; if (fth.status === 'paid') break; }
ok(fth.status === 'paid' && typeof fth.login_token === 'string', 'primeira compra de um e-mail novo continua com acesso direto');

console.log('\n11) Correções da revisão de segurança');
// M1: pedido NÃO pago com código de afiliado não "reserva" o comprador para ele
const m1 = { ...buyer(30), document: '111.444.777-35' }; // CPF sem vínculo anterior com afiliado
await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: m1, method: 'pix', affiliate_code: 'bruno' }, { headers: { 'idempotency-key': randomUUID() } });
const m1b = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: m1, method: 'pix' }, { headers: { 'idempotency-key': randomUUID() } });
const m1t = new URL('http://x' + m1b.body.next.url).searchParams.get('t');
await req('POST', `/v1/dev/sandbox/orders/${m1b.body.order_id}/pay`, { t: m1t });
await sleep(1200);
const m1d = (await req('GET', `/v1/orders/${m1b.body.order_id}/detail`, null, { cookie: 'prod' })).body;
ok(m1d.splits && !m1d.splits.some(s => s.type === 'affiliate'), 'compra direta não paga comissão a afiliado que só criou um pedido não pago');
// L1: convite de equipe exige e-mail confirmado
const unv = `nao.confirmado.${Date.now()}@example.com`;
await req('POST', '/v1/auth/signup', { name: 'Sem Confirmar', email: unv, phone: '(31) 99999-0000', password: 'Senha@Forte2026', accept_terms: true });
const inv = await req('POST', '/v1/settings/team', { email: unv, permissions: ['orders.view'] }, { cookie: 'prod' });
ok(inv.status === 422 && /confirmou o e-mail/.test(JSON.stringify(inv.body)), 'equipe: e-mail não confirmado não pode ser adicionado');
// L3: lead (dispara e-mails de recuperação) tem limite por e-mail
const spam = `alvo.${Date.now()}@example.com`;
let lastLead;
for (let i = 0; i < 6; i++) lastLead = await req('POST', '/v1/public/checkout-leads', { offer_id: offer.offer_id, email: spam });
ok(lastLead.status === 429, 'mais de 5 leads para o mesmo e-mail no dia são recusados');
// L2: sessão do comprador não nasce no domínio próprio do produtor
await req('POST', '/v1/customer/auth/magic-link', { email: b9.email });
const ob11 = (await req('GET', '/v1/dev/outbox')).body;
const ml11 = ob11.find(n => n.template === 'magic_link')?.body.match(/token=([\w-]+)/)?.[1];
const onCustom = await req('POST', '/v1/customer/auth/verify', { token: ml11 }, { headers: { 'x-dm-host': 'pay.loja-qualquer.com.br' } });
ok(onCustom.status === 403, 'login do comprador num domínio de produtor é recusado (só no endereço principal)');
// M5: caixa de saída de teste não é pública sem DEV_TOOLS (aqui DEV_TOOLS=1); a do back-office exige admin
ok((await req('GET', '/v1/admin/outbox')).status === 401, 'caixa de saída do back-office exige login');

console.log(`\n${pass} ok, ${fail} falhas\n`);
process.exit(fail ? 1 : 0);
