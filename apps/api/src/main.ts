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

(BigInt.prototype as any).toJSON = function () { return Number(this); };

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bodyParser: false, logger: ['log', 'warn', 'error'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
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
  const port = Number(process.env.PORT || process.env.API_PORT || 4000);
  await app.listen(port, process.env.LISTEN_HOST || '::');
  console.log(`Domma Mart API em http://localhost:${port}`);
}
bootstrap();
