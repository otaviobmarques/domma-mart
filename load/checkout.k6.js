// Teste de carga do checkout simulando um lançamento (seção 15, etapa 7). Ferramenta: k6 (https://k6.io).
//
//   k6 run load/checkout.k6.js                                   # contra a API local (http://localhost:4000)
//   k6 run -e BASE_URL=https://<api> -e SLUG=<oferta> -e PEAK=80 load/checkout.k6.js
//   k6 run -e BASE_URL=https://<api>.up.railway.app -e EDGE_SECRET=<segredo> -e PEAK=30 load/checkout.k6.js   # API com EDGE_SECRET
//
// Cada "comprador": abre a oferta, gera um pedido Pix e abre a tela do Pix — o caminho mais quente de um
// lançamento (Pix é a maioria das vendas de infoproduto). Compradores diferentes vêm de IPs diferentes
// (cabeçalho X-Forwarded-For), como na vida real, para não cair no limite por IP. Use só em ambiente de
// teste: cada iteração cria um pedido de verdade no banco.
import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const SLUG = __ENV.SLUG || 'confeitaria';
const PEAK = Number(__ENV.PEAK || 50); // compradores por segundo no pico
// API protegida por EDGE_SECRET (só o site acessa): o teste se identifica como o site e informa o IP do comprador
const EDGE = __ENV.EDGE_SECRET || '';
const HOLD = __ENV.HOLD || '2m';

const offerTime = new Trend('tempo_oferta', true);
const orderTime = new Trend('tempo_pedido_pix', true);
const pixTime = new Trend('tempo_tela_pix', true);
const orders = new Counter('pedidos_criados');

export const options = {
  scenarios: {
    lancamento: {
      executor: 'ramping-arrival-rate',
      startRate: Math.max(1, Math.round(PEAK / 10)), timeUnit: '1s',
      preAllocatedVUs: PEAK * 2, maxVUs: PEAK * 6,
      stages: [
        { target: Math.round(PEAK / 2), duration: '30s' }, // aquecimento: e-mail do lançamento saindo
        { target: PEAK, duration: '30s' },                  // abertura do carrinho
        { target: PEAK, duration: HOLD },                   // pico sustentado
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                         // menos de 1% de erros
    tempo_oferta: ['p(95)<300'],                            // página da oferta responde rápido
    tempo_pedido_pix: ['p(95)<1500', 'p(99)<3000'],         // gerar o Pix em até 1,5 s (p95)
    tempo_tela_pix: ['p(95)<300'],
  },
};

function cpf() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (new Set(n).size === 1) n[0] = (n[0] + 1) % 10;
  const dv = (arr) => { const s = arr.reduce((a, d, i) => a + d * (arr.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  n.push(dv(n)); n.push(dv(n));
  return n.join('');
}
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
const ip = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${1 + ((Math.random() * 253) | 0)}`;

export function setup() {
  const r = http.get(`${BASE}/v1/public/offers/${SLUG}`, { headers: EDGE ? { 'x-domma-edge': EDGE } : {} });
  if (r.status !== 200) fail(`oferta ${SLUG} não abriu (${r.status}) — confira BASE_URL e SLUG`);
  return { offerId: r.json('offer_id') };
}

export default function (data) {
  const buyerIp = ip();
  const h = { 'content-type': 'application/json', 'x-requested-with': 'domma', 'x-forwarded-for': buyerIp, ...(EDGE ? { 'x-domma-edge': EDGE, 'x-domma-client-ip': buyerIp } : {}) };
  const o = http.get(`${BASE}/v1/public/offers/${SLUG}?utm_source=carga`, { headers: h, tags: { etapa: 'oferta' } });
  offerTime.add(o.timings.duration);
  if (!check(o, { 'oferta 200': r => r.status === 200 })) return;

  const id = uuid();
  const body = JSON.stringify({
    customer: { name: 'Comprador Carga', email: `carga.${id}@example.com`, phone: `(31) 9${String(10000000 + ((Math.random() * 89999999) | 0))}`, document: cpf() },
    method: 'pix', tracking: { utm_source: 'carga' },
  });
  const p = http.post(`${BASE}/v1/checkout/${data.offerId}/orders`, body, { headers: { ...h, 'idempotency-key': id }, tags: { etapa: 'pedido' } });
  orderTime.add(p.timings.duration);
  if (!check(p, { 'pedido 201': r => r.status === 201, 'tem Pix': r => r.status === 201 && r.json('next.type') === 'pix' })) return;
  orders.add(1);

  const url = p.json('next.url'); // /pix/<id>?t=...
  const [orderId, qs] = url.replace('/pix/', '').split('?');
  const x = http.get(`${BASE}/v1/orders/${orderId}/pix?${qs}`, { headers: h, tags: { etapa: 'tela_pix' } });
  pixTime.add(x.timings.duration);
  check(x, { 'QR Code': r => r.status === 200 && String(r.json('copy_paste') || '').startsWith('000201') });
}
