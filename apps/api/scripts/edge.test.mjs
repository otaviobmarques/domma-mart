// Acesso só pelo site: API com EDGE_SECRET recusa chamadas diretas e ignora IP forjado.
// Uso: API rodando com EDGE_SECRET=segredo-de-teste-edge (e, opcional, o site em WEB apontando para ela):
//   API=http://localhost:4100 WEB=http://localhost:3100 node scripts/edge.test.mjs
const API = process.env.API || 'http://localhost:4100';
const WEB = process.env.WEB;
const SECRET = process.env.EDGE_SECRET || 'segredo-de-teste-edge';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', m); };
const call = async (base, path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'domma', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
};

console.log('\n1) Acesso direto à API');
const direct = await call(API, '/v1/public/offers/confeitaria');
ok(direct.status === 403 && /Acesso direto/.test(direct.body.title), 'sem o carimbo do site, a API recusa');
ok((await call(API, '/v1/public/offers/confeitaria', { headers: { 'x-domma-edge': 'chute' } })).status === 403, 'carimbo errado também é recusado');
ok((await call(API, '/v1/public/offers/confeitaria', { headers: { 'x-forwarded-for': '8.8.8.8', 'cf-connecting-ip': '8.8.8.8' } })).status === 403, 'cabeçalho de IP forjado não abre a porta');
ok((await call(API, '/health')).status === 200, '/health continua aberto (verificação do Railway)');
const hook = await call(API, '/webhooks/sandbox', { method: 'POST', body: { x: 1 } });
ok(!/Acesso direto/.test(JSON.stringify(hook.body)), 'webhooks continuam chegando direto (protegidos pela assinatura do gateway)');
ok((await call(API, '/v1/public/offers/confeitaria', { headers: { 'x-domma-edge': SECRET } })).status === 200, 'com o carimbo certo, responde');

console.log('\n2) IP usado nos limites');
// limite de cupom: 20 por IP em 10 min. X-Forwarded-For variando não pode zerar o contador.
const offer = (await call(API, '/v1/public/offers/confeitaria', { headers: { 'x-domma-edge': SECRET } })).body;
let last;
for (let i = 0; i < 21; i++) last = await call(API, '/v1/public/coupons/validate', { method: 'POST', headers: { 'x-domma-edge': SECRET, 'x-domma-client-ip': '203.0.113.7', 'x-forwarded-for': `198.51.100.${i}` }, body: { offer_id: offer.offer_id, code: 'BEMVINDO' } });
ok(last.status === 429, 'trocar X-Forwarded-For a cada pedido não fura o limite por IP (21º pedido bloqueado)');
const other = await call(API, '/v1/public/coupons/validate', { method: 'POST', headers: { 'x-domma-edge': SECRET, 'x-domma-client-ip': '203.0.113.8' }, body: { offer_id: offer.offer_id, code: 'BEMVINDO' } });
ok(other.status === 200, 'outro comprador (IP visto pelo site) segue normal');

if (WEB) {
  console.log('\n3) Pelo site');
  ok((await call(WEB, '/v1/public/offers/confeitaria')).status === 200, 'o site carimba e a oferta abre');
  ok((await call(WEB, '/v1/public/offers/confeitaria', { headers: { 'x-domma-edge': 'forjado', 'x-domma-client-ip': '203.0.113.7' } })).status === 200, 'carimbo forjado pelo visitante é substituído pelo do site');
  const c = await call(WEB, '/v1/public/coupons/validate', { method: 'POST', headers: { 'x-domma-client-ip': '203.0.113.7' }, body: { offer_id: offer.offer_id, code: 'BEMVINDO' } });
  ok(c.status === 200, 'visitante não consegue se passar por outro IP pelo cabeçalho do carimbo');
  ok((await fetch(WEB + '/pay/confeitaria')).status === 200, 'checkout abre');
}
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
