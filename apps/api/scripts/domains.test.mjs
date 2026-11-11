// Domínio próprio contra uma API falsa do Vercel. Uso (API rodando com VERCEL_API_URL=http://127.0.0.1:4220,
// VERCEL_TOKEN e VERCEL_PROJECT_ID definidos): node scripts/domains.test.mjs
import http from 'node:http';
const API = process.env.API || 'http://localhost:4100';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', m); };
let verified = false;
const calls = [];
const fake = http.createServer((req, res) => {
  calls.push(`${req.method} ${req.url.split('?')[0]}`);
  const auth = req.headers.authorization === 'Bearer token-teste';
  res.writeHead(auth ? 200 : 403, { 'content-type': 'application/json' });
  if (!auth) return res.end('{}');
  if (req.method === 'POST' && req.url.includes('/verify')) return res.end(JSON.stringify({ verified, verification: verified ? [] : [{ type: 'TXT', domain: '_vercel.loja-teste.com.br', value: 'vc-domain-verify=abc' }] }));
  if (req.method === 'GET' && req.url.includes('/config')) return res.end(JSON.stringify({ misconfigured: !verified }));
  if (req.method === 'POST') return res.end(JSON.stringify({ verified: false, verification: [{ type: 'TXT', domain: '_vercel.loja-teste.com.br', value: 'vc-domain-verify=abc' }] }));
  res.end('{}');
});
await new Promise(r => fake.listen(4220, '127.0.0.1', r));

const jars = {};
async function req(method, path, body, who, headers = {}) {
  const h = { 'content-type': 'application/json', 'x-requested-with': 'domma', ...headers };
  if (who && jars[who]) h.cookie = jars[who];
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (who && sc.length) jars[who] = sc.map(s => s.split(';')[0]).join('; ');
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
await req('POST', '/v1/auth/login', { email: 'produtora@demo.com', password: 'Domma@Mart2026' }, 'prod');
await req('POST', '/v1/auth/login', { email: 'afiliado@demo.com', password: 'Domma@Mart2026' }, 'outro');
const host = 'pay.loja-teste.com.br';

const st = await req('GET', '/v1/settings/domains', null, 'prod');
ok(st.body.enabled === true, 'domínio próprio habilitado com as credenciais do Vercel');
ok((await req('POST', '/v1/settings/domains', { hostname: 'loja.vercel.app' }, 'prod')).status === 422, 'domínio da própria plataforma é recusado');
ok((await req('POST', '/v1/settings/domains', { hostname: 'não é domínio' }, 'prod')).status === 422, 'texto que não é domínio é recusado');
const add = await req('POST', '/v1/settings/domains', { hostname: `https://${host.toUpperCase()}/` }, 'prod');
ok(add.status === 201 && add.body.hostname === host && add.body.status === 'pending', 'cadastro normaliza o domínio e fica aguardando DNS');
ok(add.body.dns?.[0]?.type === 'CNAME' && add.body.dns[0].name === 'pay' && add.body.dns[0].value === 'cname.vercel-dns.com', 'instrução de CNAME correta para subdomínio .com.br');
ok(add.body.dns?.some(r => r.type === 'TXT'), 'registro TXT de verificação do Vercel repassado');
ok(calls.includes('POST /v10/projects/prj_teste/domains'), 'domínio registrado no projeto do Vercel');
ok((await req('POST', '/v1/settings/domains', { hostname: host }, 'outro')).status === 422, 'outra conta não pode cadastrar o mesmo domínio');
ok((await req('GET', `/v1/public/domains/${host}`)).status === 404, 'domínio pendente ainda não atende');
let v = await req('POST', `/v1/settings/domains/${add.body.id}/verify`, {}, 'prod');
ok(v.body.status === 'pending' && !!v.body.last_error, 'sem DNS, a verificação mantém pendente e explica');
verified = true;
v = await req('POST', `/v1/settings/domains/${add.body.id}/verify`, {}, 'prod');
ok(v.body.status === 'active' && !!v.body.verified_at, 'com DNS certo, o domínio fica ativo');
ok((await req('GET', `/v1/public/domains/${host}`)).body.workspace_id, 'domínio ativo resolve para a conta');
ok((await req('GET', '/v1/public/offers/confeitaria', null, null, { 'x-dm-host': host })).status === 200, 'oferta da própria produtora abre no domínio dela');
// oferta de outra conta
const p = await req('POST', '/v1/products', { type: 'service', name: 'Mentoria do Outro', price_cents: 5000 }, 'outro');
await req('PATCH', `/v1/products/${p.body.product_id}`, { service_url: 'https://agenda.exemplo.com' }, 'outro');
const pub = await req('POST', `/v1/products/${p.body.product_id}/publish`, {}, 'outro');
const slug = pub.body.checkout_url?.split('/').pop();
ok((await req('GET', `/v1/public/offers/${slug}`)).status === 200, 'oferta da outra conta abre no endereço principal');
ok((await req('GET', `/v1/public/offers/${slug}`, null, null, { 'x-dm-host': host })).status === 410, 'oferta de outra conta NÃO abre no domínio da produtora');
const offer = (await req('GET', `/v1/public/offers/${slug}`)).body;
const order = await req('POST', `/v1/checkout/${offer.offer_id}/orders`, { customer: { name: 'Teste Dominio', email: `d.${Date.now()}@example.com`, phone: '(31) 99999-0000', document: '52998224725' }, method: 'pix' }, null, { 'x-dm-host': host, 'idempotency-key': crypto.randomUUID() });
ok(order.status === 410, 'pedido de oferta de outra conta é recusado no domínio da produtora');
const del = await req('DELETE', `/v1/settings/domains/${add.body.id}`, null, 'prod');
ok(del.status === 200 && calls.some(c => c.startsWith('DELETE /v9/projects/prj_teste/domains/')), 'remover tira o domínio do Vercel');
fake.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
