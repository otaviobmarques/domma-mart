// Teste do login com Google contra um servidor OAuth falso. Uso (com a API rodando com as variáveis
// GOOGLE_* apontando para http://127.0.0.1:4210): node scripts/google-oauth.test.mjs
import http from 'node:http';
import { createHash } from 'node:crypto';
const API = process.env.API || 'http://localhost:4100';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  ✓' : '  ✗', m); };
let profile = {};
const challenges = new Map();
const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/token') {
    let b = ''; for await (const c of req) b += c;
    const p = new URLSearchParams(b);
    const ch = challenges.get(p.get('code'));
    const okPkce = ch && createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === ch;
    if (!okPkce || p.get('client_secret') !== 'segredo-teste') { res.writeHead(400); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'at_' + p.get('code') }));
  }
  if (u.pathname === '/userinfo') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(profile)); }
  res.writeHead(404); res.end();
});
await new Promise(r => fake.listen(4210, '127.0.0.1', r));

async function flow({ aceite = true, tamper = false } = {}) {
  const s = await fetch(`${API}/v1/auth/google/start?volta=/produtos${aceite ? '&aceite=1' : ''}`, { redirect: 'manual' });
  const loc = new URL(s.headers.get('location'));
  const cookie = s.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const code = 'c' + Math.random().toString(36).slice(2);
  challenges.set(code, loc.searchParams.get('code_challenge'));
  const state = tamper ? 'estado-falso' : loc.searchParams.get('state');
  const cb = await fetch(`${API}/v1/auth/google/callback?code=${code}&state=${state}`, { redirect: 'manual', headers: { cookie } });
  const session = cb.headers.getSetCookie().find(c => c.startsWith('dm_session='))?.split(';')[0];
  return { start: s, loc, cb, to: cb.headers.get('location'), session };
}

const prov = await (await fetch(`${API}/v1/auth/providers`)).json();
ok(prov.google === true, 'provedor Google habilitado');
const email = `google.${Date.now()}@gmail.com`;
profile = { sub: 'g-' + Date.now(), email, email_verified: true, name: 'Carla Google' };

let r = await flow({ aceite: false });
ok(r.loc.pathname === '/auth' && r.loc.searchParams.get('code_challenge_method') === 'S256', 'redireciona ao Google com PKCE S256');
ok(r.to?.includes('/criar-conta?google=1') && !r.session, 'conta nova sem aceite dos termos volta para o cadastro');
r = await flow({ aceite: true });
ok(r.to?.endsWith('/produtos') && !!r.session, 'conta nova com aceite é criada e entra no destino pedido');
const me = await (await fetch(`${API}/v1/auth/me`, { headers: { cookie: r.session } })).json();
ok(me.user?.email === email && me.user.email_verified === true && !!me.workspace, 'usuário com e-mail verificado e workspace próprio');
r = await flow({ aceite: false });
ok(r.to?.endsWith('/produtos') && !!r.session, 'entrar de novo pelo Google não pede termos');
r = await flow({ tamper: true });
ok(r.to?.includes('erro=google_expirado') && !r.session, 'state adulterado é recusado (anti-CSRF)');
profile = { sub: 'g-x' + Date.now(), email: 'nao.verificado@gmail.com', email_verified: false, name: 'X' };
r = await flow();
ok(r.to?.includes('erro=google_email_nao_verificado') && !r.session, 'e-mail não verificado pelo Google é recusado');
profile = { sub: 'g-link' + Date.now(), email: 'produtora@demo.com', email_verified: true, name: 'Ana' };
r = await flow({ aceite: false });
ok(r.to?.endsWith('/produtos') && !!r.session, 'conta existente com o mesmo e-mail é vinculada');
// sequestro prévio: alguém cria conta com senha usando o e-mail da vítima e nunca confirma
const victim = `vitima.${Date.now()}@gmail.com`;
const su = await fetch(`${API}/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'domma' }, body: JSON.stringify({ name: 'Invasor Teste', email: victim, phone: '(31) 99999-0000', password: 'senha-do-invasor-123', accept_terms: true }) });
const attackerSession = su.headers.getSetCookie().find(c => c.startsWith('dm_session='))?.split(';')[0];
profile = { sub: 'g-vit' + Date.now(), email: victim, email_verified: true, name: 'Vítima Real' };
r = await flow({ aceite: false });
ok(!!r.session, 'dona real do e-mail entra pelo Google');
const att = await fetch(`${API}/v1/auth/me`, { headers: { cookie: attackerSession } });
ok(att.status === 401, 'sessão do invasor foi encerrada');
const li = await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'domma' }, body: JSON.stringify({ email: victim, password: 'senha-do-invasor-123' }) });
ok(li.status === 401, 'senha do invasor não funciona mais');
const noState = await fetch(`${API}/v1/auth/google/callback?code=x&state=y`, { redirect: 'manual' });
ok(noState.headers.get('location')?.includes('erro=google_expirado'), 'retorno sem o cookie de estado é recusado');

fake.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
