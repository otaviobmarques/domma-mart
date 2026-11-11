import { SCOPES } from '../../domain/api-keys';
import { WEBHOOK_EVENTS } from '../../domain/webhook-events';

/** Especificação OpenAPI 3.1 da API pública (servida em /api/v1/openapi.json e usada na página /desenvolvedores). */
export function buildPublicSpec() {
  const list = (item: string) => ({ type: 'object', properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${item}` } }, has_more: { type: 'boolean' }, next_cursor: { type: ['string', 'null'] } } });
  const paging = [
    { name: 'limit', in: 'query', description: 'Itens por página (1–100, padrão 50).', schema: { type: 'integer' } },
    { name: 'cursor', in: 'query', description: 'next_cursor da página anterior.', schema: { type: 'string' } },
  ];
  const op = (summary: string, scope: string | null, extra: any = {}) => {
    const { description, ...rest } = extra;
    return { summary, description: [scope ? `Permissão: \`${scope}\`.` : 'Qualquer chave válida.', description].filter(Boolean).join(' '), 'x-scope': scope, security: [{ bearer: [] }], ...rest };
  };
  const ok = (schema: any) => ({ '200': { description: 'OK', content: { 'application/json': { schema } } }, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '429': { $ref: '#/components/responses/RateLimited' } });
  const money = { type: 'integer', description: 'Centavos' };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Domma Mart — API pública', version: '1.0.0',
      description: 'Acesse vendas, compradores, produtos, cupons e afiliados da sua conta, e inscreva webhooks (Zapier, n8n). Valores em centavos, datas em ISO 8601 (UTC). Limite: 120 chamadas por minuto por chave.',
    },
    servers: [{ url: `${process.env.APP_URL || 'https://domma-mart.vercel.app'}/api/v1` }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Chave criada em Configurações › API e integrações (dm_live_...).' } },
      'x-scopes': SCOPES,
      responses: {
        Unauthenticated: { description: 'Chave ausente, inválida ou revogada.' },
        Forbidden: { description: 'A chave não tem a permissão desta rota.' },
        RateLimited: { description: 'Mais de 120 chamadas por minuto com esta chave.' },
      },
      schemas: {
        Sale: { type: 'object', properties: {
          id: { type: 'string' }, code: { type: 'string', example: 'DM-AB12CD' }, status: { type: 'string', enum: ['created', 'pending', 'paid', 'failed', 'expired', 'refund_requested', 'refunded', 'chargeback', 'chargeback_won', 'chargeback_lost'] },
          status_label: { type: 'string' }, method: { type: 'string', enum: ['pix', 'card', 'boleto'] }, installments: { type: 'integer' },
          subtotal_cents: money, discount_cents: money, interest_cents: money, total_cents: money, net_cents: { ...money, description: 'Quanto a sua conta recebe nesta venda' },
          created_at: { type: 'string', format: 'date-time' }, paid_at: { type: ['string', 'null'] }, refunded_at: { type: ['string', 'null'] },
          items: { type: 'array', items: { type: 'object', properties: { product_id: { type: 'string' }, offer_id: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', enum: ['main', 'bump'] }, price_cents: money } } },
          customer: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string', description: 'Só com customers:read' }, document: { type: 'string', description: 'CPF/CNPJ, só com customers:read' } } },
          affiliate: { type: ['object', 'null'] }, coupon: { type: ['string', 'null'] }, subscription_id: { type: ['string', 'null'] }, funnel_step: { type: ['string', 'null'], enum: ['upsell', 'downsell', null] },
          tracking: { type: 'object', description: 'UTMs da venda' },
        } },
        Customer: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, document: { type: 'string' }, orders: { type: 'integer' }, paid_cents: money, first_order_at: { type: 'string' }, last_order_at: { type: 'string' } } },
        Product: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' }, offers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, price_cents: money, checkout_url: { type: 'string' } } } } } },
        Coupon: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, kind: { type: 'string', enum: ['percent', 'fixed'] }, value: { type: 'integer', description: 'percent: pontos-base (1000 = 10%); fixed: centavos' }, offer_ids: { type: 'array', items: { type: 'string' } }, ends_at: { type: ['string', 'null'] }, max_uses: { type: ['integer', 'null'] }, uses: { type: 'integer' }, active: { type: 'boolean' } } },
        Subscription: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['trialing', 'active', 'past_due', 'canceled', 'defaulted'] }, price_cents: money, current_period_end: { type: 'string' }, next_charge_at: { type: ['string', 'null'] }, customer: { type: 'object' } } },
        Refund: { type: 'object', properties: { id: { type: 'string' }, order_id: { type: 'string' }, order_code: { type: 'string' }, requested_by: { type: 'string' }, amount_cents: money, status: { type: 'string', enum: ['processing', 'done', 'failed'] } } },
        Affiliate: { type: 'object', properties: { id: { type: 'string' }, product_id: { type: 'string' }, status: { type: 'string' }, code: { type: 'string' }, affiliate: { type: 'object' }, sales: { type: 'integer' }, commissions_cents: money } },
        Webhook: { type: 'object', properties: { id: { type: 'string' }, url: { type: 'string' }, events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENTS] } } } },
      },
    },
    paths: {
      '/me': { get: op('Conta e permissões da chave', null, { responses: ok({ type: 'object' }) }) },
      '/sales': { get: op('Listar vendas', 'sales:read', { description: 'Mais recentes primeiro.', parameters: [...paging,
        { name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'product_id', in: 'query', schema: { type: 'string' } }, { name: 'email', in: 'query', description: 'E-mail do comprador', schema: { type: 'string' } },
        { name: 'created_since', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'created_until', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'paid_since', in: 'query', schema: { type: 'string', format: 'date-time' } },
      ], responses: ok(list('Sale')) }) },
      '/sales/{id}': { get: op('Uma venda (id ou código DM-...)', 'sales:read', { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: ok({ $ref: '#/components/schemas/Sale' }) }) },
      '/refunds': { get: op('Listar reembolsos', 'sales:read', { parameters: paging, responses: ok(list('Refund')) }) },
      '/subscriptions': { get: op('Listar assinaturas', 'sales:read', { parameters: [...paging, { name: 'status', in: 'query', schema: { type: 'string' } }], responses: ok(list('Subscription')) }) },
      '/customers': { get: op('Listar compradores (dados completos)', 'customers:read', { parameters: paging, responses: ok(list('Customer')) }) },
      '/products': { get: op('Listar produtos e ofertas', 'products:read', { responses: ok(list('Product')) }) },
      '/coupons': {
        get: op('Listar cupons', 'products:read', { responses: ok(list('Coupon')) }),
        post: op('Criar cupom', 'coupons:write', { requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['code', 'kind', 'value'], properties: { code: { type: 'string' }, kind: { type: 'string', enum: ['percent', 'fixed'] }, value: { type: 'integer' }, offer_ids: { type: 'array', items: { type: 'string' } }, ends_at: { type: 'string', format: 'date-time' }, max_uses: { type: 'integer' }, max_uses_per_cpf: { type: 'integer' } } } } } }, responses: ok({ $ref: '#/components/schemas/Coupon' }) }),
      },
      '/coupons/{id}': { patch: op('Ativar/desativar ou mudar validade de cupom', 'coupons:write', { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { active: { type: 'boolean' }, ends_at: { type: ['string', 'null'] }, max_uses: { type: ['integer', 'null'] } } } } } }, responses: ok({ $ref: '#/components/schemas/Coupon' }) }) },
      '/affiliates': { get: op('Listar afiliados dos seus produtos', 'affiliates:read', { parameters: paging, responses: ok(list('Affiliate')) }) },
      '/webhooks': {
        get: op('Listar webhooks ativos', 'webhooks:write', { responses: ok(list('Webhook')) }),
        post: op('Inscrever webhook (Zapier/n8n)', 'webhooks:write', { description: 'Devolve o segredo (whsec_...) para conferir a assinatura X-DommaMart-Signature.', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['url', 'events'], properties: { url: { type: 'string' }, events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENTS] } } } } } } }, responses: ok({ $ref: '#/components/schemas/Webhook' }) }),
      },
      '/webhooks/{id}': { delete: op('Remover webhook', 'webhooks:write', { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: ok({ type: 'object' }) }) },
      '/events/sample': { get: op('Exemplo de evento de webhook', null, { parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: [...WEBHOOK_EVENTS] } }], responses: ok({ type: 'array' }) }) },
    },
  };
}
