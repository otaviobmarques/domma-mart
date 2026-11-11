# Domma Mart

Plataforma de checkout, pagamentos com divisão automática, área de membros e afiliados para produtores
digitais — implementação do **Descritivo Técnico v2.0** (MVP / Fase 1).

```
apps/api   NestJS + Prisma + PostgreSQL 16 + Redis/BullMQ   (porta 4000)
apps/web   Next.js 15 + Tailwind (checkout, painel, membros, back-office)   (porta 3000)
```

O front faz proxy de `/v1/*`, `/r/*` e `/webhooks/*` para a API (mesma origem → cookies HttpOnly + SameSite).

## Rodar localmente

```bash
docker compose up -d                      # Postgres + Redis
npm install
cp apps/api/.env.example apps/api/.env    # troque as chaves antes de produção
npm run db:migrate
npm run build -w apps/api && npm run db:seed
npm run start -w apps/api                 # API em :4000
npm run build -w apps/web && npm run start -w apps/web   # Web em :3000
```

O seed imprime as contas de demonstração (senha `Domma@Mart2026`) e os segredos TOTP para o app autenticador:
`produtora@demo.com`, `afiliado@demo.com` e o back-office, que entra com o usuário **`Admin`** (ou `admin@dommamart.com`) e exige 2FA. A senha do Admin vem da variável `ADMIN_PASSWORD` na primeira execução do seed.

- Checkout de exemplo: http://localhost:3000/pay/confeitaria (cupom `BEMVINDO`, link de afiliado `/r/bruno/confeitaria`)
- Caixa de saída de e-mails/WhatsApp em desenvolvimento: http://localhost:3000/dev/caixa-de-saida
- Cartões de teste do sandbox: `4111 1111 1111 1111` aprova, `4000 0000 0000 0002` recusa, `4000 0000 0000 9995` sem limite.

## Testes

```bash
npm test                                        # unitários + propriedades (taxas, divisão, liberação, TOTP, validações)
PROD_TOTP=<segredo da produtora> node apps/api/scripts/smoke.mjs   # ponta a ponta contra a API rodando
```

## O que está implementado (mapa do descritivo)

| Seção | Onde |
|---|---|
| Taxas, parcelamento, divisão, liberação (RN-01…12, 35) | `api/src/domain/money.ts` (+ testes de propriedade) |
| Máquina de estados do pedido (8.1) | `domain/order-state.ts`, `modules/orders/orders.service.ts` |
| Checkout, Pix, obrigado, cupom, oferta especial, antifraude (19.1–19.3, RN-13…30, 60…64) | `modules/checkout`, `web/app/pay`, `web/app/pix`, `web/app/obrigado` |
| Ledger de dupla entrada somente-inserção (5.4, 21.6) | `modules/ledger`, trigger em `prisma/migrations/1_ledger_guards` |
| Saque com 2FA, carência de chave 24 h, lock de concorrência (8.4, RN-36…39) | `modules/finance`, `web/app/(painel)/financeiro` |
| Reembolso, contestação, saldo negativo (8.5, RN-50…55) | `orders.service.ts` |
| Área do cliente sem senha (19.4, 19.5, RN-80…83) | `modules/customer`, `web/app/minhas-compras` |
| Área de membros, URLs assinadas, marca d'água, 2 aparelhos, drip, certificado (19.6, RN-90…94) | `modules/members`, `modules/files`, `web/app/curso` |
| Painel do produtor: início, criar produto em 3 passos, vendas, editor de oferta (19.7, 19.8, 19.12) | `web/app/(painel)` |
| Afiliados e sócios (5.6, 19.10, RN-70…74) | `modules/affiliates`, `checkout.service.ts → resolveAffiliate` |
| Recuperação de vendas e notificações (5.7, 24, RN-40…42) | `modules/jobs`, `infra/notify.service.ts` |
| Webhooks de saída HMAC + retentativas + SSRF (9.3, 22.7) | `jobs.service.ts`, `modules/integrations/ssrf.ts` |
| Back-office: KYC, moderação, contas, disputas, risco, conciliação, auditoria com hash encadeado (5.10, 19.11) | `modules/admin`, `web/app/admin` |
| Segurança: Argon2id, senhas vazadas (k-anonymity), bloqueio progressivo, RBAC + RLS, cripto de campo AES-GCM + índice cego HMAC, CSRF, CSP | `http/auth.guard.ts`, `common/crypto.ts`, `auth.controller.ts` |

## Login com Google

Fica desligado (botão escondido) até existirem as duas variáveis na **API**:

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *Criar credenciais* → *ID do cliente OAuth* → tipo **Aplicativo da Web**.
2. Em *URIs de redirecionamento autorizados*, adicione `https://<seu-site>/v1/auth/google/callback` (homologação: `https://domma-mart.vercel.app/v1/auth/google/callback`).
3. Coloque `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` nas variáveis do serviço `api` no Railway.

Teste automatizado com servidor OAuth falso: `apps/api/scripts/google-oauth.test.mjs`.

## Domínio próprio do produtor

O produtor cadastra `pay.seusite.com.br` em **Configurações › Domínio próprio**, cria o CNAME indicado e clica em *Verificar*; o SSL é emitido pelo Vercel. Nesse domínio só as ofertas daquele produtor são vendidas e o painel/back-office não existem.

Para ligar, coloque na **API** (Railway): `VERCEL_TOKEN` (token com acesso ao projeto), `VERCEL_PROJECT_ID` e `VERCEL_TEAM_ID`. No **site** (Vercel), opcionalmente `MAIN_HOSTS` com os domínios principais (ex.: `dommamart.com.br`); `*.vercel.app` já é tratado como principal.

Teste com API falsa do Vercel: `apps/api/scripts/domains.test.mjs`.

## Pendências antes de produção

- **Gateway real** (decisão D1): hoje roda com o adaptador *sandbox*. Ver `apps/api/src/modules/gateway/README.md`.
- **Vídeo**: o armazenamento é local com URLs assinadas; trocar por Bunny/Cloudflare Stream e R2/S3 (bucket KYC separado).
- **Credenciais**: Resend (`RESEND_API_KEY`), Domma Chat (`DOMMA_CHAT_URL`/`TOKEN`), Cloudflare Turnstile (`TURNSTILE_SECRET`/`TURNSTILE_SITE_KEY`), KMS para as chaves de campo, cofre de segredos.
- **Não implementado no MVP**: ajuste manual de ledger com aprovação de 2 pessoas (RN-38), consulta automática à Receita no KYC, antivírus de upload, emissão de nota fiscal, recursos da Fase 2/3.
- **Jurídico/contábil** (seção 12): termos, privacidade, enquadramento regulatório e impostos.
- **Revisão humana sênior + pentest** dos módulos de pagamento, ledger e segurança (seções 15 e 16).
