import 'reflect-metadata';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
// carrega .env simples (produção usa cofre de segredos — seção 11.6)
const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { buildOpenApi } from './openapi';
import { edgeGuard } from './http/edge';

(BigInt.prototype as any).toJSON = function () { return Number(this); };

/** Em produção, a API não sobe com configuração insegura (revisão de segurança, item M5). */
function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (!process.env.EDGE_SECRET) problems.push('EDGE_SECRET (acesso só pelo site)');
  if (!process.env.TURNSTILE_SECRET) problems.push('TURNSTILE_SECRET (proteção contra robôs no checkout)');
  if ((process.env.GATEWAY_PROVIDER || 'sandbox') === 'sandbox') problems.push('GATEWAY_PROVIDER real (sandbox não processa dinheiro)');
  if (!process.env.RESEND_API_KEY) problems.push('RESEND_API_KEY (sem ele, links e códigos de acesso iriam para o log)');
  if (process.env.DEV_TOOLS === '1') problems.push('DEV_TOOLS precisa estar desligado');
  if (process.env.SEED_DEMO === '1') problems.push('SEED_DEMO precisa estar desligado');
  if (problems.length) { console.error(`[segurança] configuração de produção incompleta:\n - ${problems.join('\n - ')}`); process.exit(1); }
}

async function bootstrap() {
  assertProductionConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bodyParser: false, logger: ['log', 'warn', 'error'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(edgeGuard); // só o site (Vercel) acessa a API — ver http/edge.ts
  app.use(cookieParser());
  // partes de upload chegam como binário
  app.use(/^\/v1\/uploads\/[^/]+\/parts\/\d+$/, express.raw({ type: '*/*', limit: '9mb' }));
  app.use(express.json({ limit: '12mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    // cabeçalhos de segurança (11.5)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if ((process.env.APP_URL || '').startsWith('https')) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    next();
  });
  // Documentação gerada do código (25.2)
  if (process.argv.includes('--openapi')) {
    await app.init();
    const { writeFileSync } = await import('node:fs');
    const out = resolve(__dirname, '../../../docs/openapi.json');
    writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2) + '\n');
    console.log(`OpenAPI gravado em ${out}`);
    await app.close();
    process.exit(0);
  }
  let spec: unknown;
  app.getHttpAdapter().get('/v1/openapi.json', (_req: any, res: any) => { spec ??= buildOpenApi(app); res.json(spec); });
  const port = Number(process.env.PORT || process.env.API_PORT || 4000);
  // '::' atende IPv4 e IPv6 (rede privada do Railway é IPv6); sem IPv6 na máquina, cai para 0.0.0.0
  try {
    await app.listen(port, process.env.LISTEN_HOST || '::');
  } catch (e: any) {
    if (process.env.LISTEN_HOST || e?.code !== 'EAFNOSUPPORT') throw e;
    await app.listen(port, '0.0.0.0');
  }
  console.log(`Domma Mart API em http://localhost:${port}`);
}
bootstrap();
