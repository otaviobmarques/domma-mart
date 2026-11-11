import { INestApplication, RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { AUTH_KEY, AuthSpec } from './http/context';
import { ERRORS } from './common/errors';

/**
 * OpenAPI 3.1 gerado a partir do código (definição de pronto, seção 25.2): percorre os controllers
 * registrados e lê rota, método HTTP e a exigência de autenticação/permissão de cada handler.
 */
const METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'get', [RequestMethod.POST]: 'post', [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch', [RequestMethod.DELETE]: 'delete',
};
const IDEMPOTENT = [/checkout\/\{offerId\}\/orders$/, /\/refund$/, /finance\/withdrawals$/];
const OTP = [/finance\/withdrawals$/, /finance\/payout-account$/, /orders\/\{id\}\/refund$/];

export function buildOpenApi(app: INestApplication) {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const paths: Record<string, Record<string, unknown>> = {};

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const proto = Object.getPrototypeOf(instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const sub = Reflect.getMetadata(PATH_METADATA, handler);
      if (sub === undefined) continue;
      const verb = METHODS[Reflect.getMetadata(METHOD_METADATA, handler)];
      if (!verb) continue;
      const raw = ['', base, String(sub)].join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      const path = raw.replace(/:(\w+)/g, '{$1}');
      const auth = reflector.getAllAndOverride<AuthSpec>(AUTH_KEY, [handler, metatype]) ?? { kind: 'public' };
      const params: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
      if (IDEMPOTENT.some(r => r.test(path)) && verb === 'post') params.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' }, description: 'RN-30: a mesma chave em até 24 h devolve o mesmo resultado.' });
      if (OTP.some(r => r.test(path)) && verb !== 'get') params.push({ name: 'X-OTP', in: 'header', required: false, schema: { type: 'string', pattern: '^\\d{6}$' }, description: 'Código TOTP (2FA).' });
      const tag = path.split('/').filter(Boolean).find(s => s !== 'v1' && !s.startsWith('{')) ?? 'root';
      const perm = 'perm' in auth ? auth.perm : undefined;
      const security = auth.kind === 'public' ? [] : auth.kind === 'customer' ? [{ customerSession: [] }] : [{ producerSession: [] }];
      paths[path] ??= {};
      paths[path][verb] = {
        operationId: `${metatype.name.replace(/Controller$/, '')}_${name}`,
        tags: [tag],
        summary: name.replace(/([A-Z])/g, ' $1').toLowerCase(),
        description: [`Acesso: ${auth.kind}${perm ? ` (permissão ${perm})` : ''}.`, auth.kind !== 'public' && verb !== 'get' ? 'Exige o cabeçalho X-Requested-With: domma (CSRF).' : ''].filter(Boolean).join(' '),
        security,
        parameters: params,
        ...(['post', 'put', 'patch'].includes(verb) ? { requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } },
          default: { description: 'Erro (RFC 7807)', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      };
    }
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Domma Mart API', version: '1.0.0', description: 'Valores em centavos (inteiros), datas ISO 8601, campos em snake_case. Erros em application/problem+json com `code` estável (seção 23).' },
    servers: [{ url: '/' }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        producerSession: { type: 'apiKey', in: 'cookie', name: 'dm_session', description: 'Sessão do produtor/equipe/back-office (HttpOnly).' },
        customerSession: { type: 'apiKey', in: 'cookie', name: 'dm_customer', description: 'Sessão do comprador (link mágico ou código).' },
      },
      schemas: {
        Problem: {
          type: 'object', required: ['code', 'title', 'status'],
          properties: { type: { type: 'string' }, code: { type: 'string', enum: Object.keys(ERRORS) }, title: { type: 'string' }, status: { type: 'integer' }, fields: { type: 'object', additionalProperties: { type: 'string' } } },
        },
      },
    },
  };
}
