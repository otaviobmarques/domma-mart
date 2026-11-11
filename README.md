# Domma Mart

Plataforma de checkout, pagamentos com divisão automática, área de membros e afiliados para produtores
digitais — implementação do **Descritivo Técnico v2.0** (MVP / Fase 1).

```
apps/api   NestJS 12 + Prisma + PostgreSQL 16 + Redis/BullMQ   (porta 4000)
apps/web   Next.js 16 + Tailwind (checkout, painel, membros, back-office)   (porta 3000)
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

## Gateway Pagar.me

O adaptador da Pagar.me (API v5) está pronto; o ambiente de teste continua no *sandbox* até as chaves chegarem. Para ligar, na **API** (Railway):

| Variável | O que é |
|---|---|
| `GATEWAY_PROVIDER` | `pagarme` |
| `PAGARME_SECRET_KEY` | chave secreta (`sk_test_…` em teste, `sk_…` em produção) |
| `PAGARME_PUBLIC_KEY` | chave pública (`pk_…`), usada no navegador para tokenizar o cartão |
| `PAGARME_PLATFORM_RECIPIENT_ID` | recebedor principal da Domma (`rp_…`), que fica com a taxa e responde por chargeback |
| `PAGARME_WEBHOOK_USER` / `PAGARME_WEBHOOK_PASSWORD` | usuário e senha (16+ caracteres) da autenticação básica do webhook |
| `PAGARME_STATEMENT` | opcional: nome na fatura do cartão (até 13 letras, padrão `DOMMA`) |

No **painel da Pagar.me**: cadastre o domínio do checkout (ex.: `domma-mart.vercel.app`) para a tokenização funcionar, e crie o webhook `https://<site>/webhooks/pagarme` com autenticação básica (o mesmo usuário e senha) para os eventos `charge.paid`, `charge.payment_failed`, `charge.refunded` e `chargeback.received`.

Como funciona:
- Cada produtor, afiliado e coprodutor vira um **recebedor** na Pagar.me assim que envia a identidade (com endereço, telefone e renda, exigidos pelo Banco Central) e cadastra a **conta bancária** de saque no próprio CPF/CNPJ. Sem recebedor, o checkout do produtor fica bloqueado com aviso no painel.
- O **split** vai em cada cobrança em valores fixos; a plataforma fica com a taxa do gateway, o resto dos arredondamentos e a responsabilidade por chargeback.
- O **saque** é uma transferência do recebedor para a conta bancária dele; o job `transfers.poll` consulta o estado a cada 10 minutos.
- O **cartão** é tokenizado no navegador (`api.pagar.me/core/v5/tokens`); a API da Domma só vê o token.

Testes: `apps/api/src/modules/gateway/pagarme.test.ts` (unitário) e `apps/api/scripts/pagarme.test.mjs` (ponta a ponta contra uma Pagar.me falsa, também no CI).

## Compra com 1 clique

No checkout com cartão, o comprador pode marcar **“Guardar este cartão para comprar com 1 clique”**. Guardamos só a referência do cartão no gateway (cifrada), a bandeira e o final. Na próxima compra, em qualquer aparelho, ele clica em *“Já comprou aqui com cartão?”*, recebe um **código de 6 números por e-mail** e paga sem digitar dados nem cartão. O código vale 10 minutos e é de uso único (5 tentativas). A resposta é a mesma para e-mails com ou sem cartão, para não revelar quem é cliente. O comprador vê e remove os cartões em **Minhas compras**.

## 3-D Secure

Com a Pagar.me, `PAGARME_3DS=on` liga a confirmação do banco (3DS 2.x da Stone) para Visa e Mastercard. O checkout pede o endereço da fatura (o CEP preenche o resto), roda a biblioteca `3ds-nx-js` no navegador e manda só o id da transação autenticada; se o banco negar, a cobrança nem é criada. O ambiente (teste ou produção) segue a chave (`sk_test_…` → sandbox) ou `PAGARME_3DS_ENV`. A compra com 1 clique não passa por 3DS (a Stone não autentica cartão guardado).

## Teste de carga

`load/checkout.k6.js` (k6) simula um lançamento: cada comprador abre a oferta, gera um Pix e abre a tela do Pix, com rampa até `PEAK` compradores por segundo.

```bash
k6 run -e BASE_URL=http://localhost:4000 -e SLUG=confeitaria -e PEAK=50 load/checkout.k6.js
```

Resultado com **1 processo da API** (4 vCPUs divididas com Postgres, Redis e o próprio k6):

| Pico | Pedidos Pix/s | Gerar Pix (p95) | Oferta (p95) | Erros |
|---|---|---|---|---|
| 50/s, antes da otimização | 32 | 5,5 s | 1,9 s | 0% |
| 50/s | 37 (todos atendidos) | 60 ms | 17 ms | 0% |
| 120/s | ~68 (saturado) | 6,6 s | 2,2 s | 0% |

O gargalo era desenhar o QR Code do Pix em PNG (metade da CPU); agora é SVG. Cada processo aguenta **~65 pedidos Pix por segundo** (~230 mil por hora) sem erro; acima disso, a fila cresce mas nada falha. Para lançamentos maiores, aumente as réplicas da API no Railway (ela não guarda estado: sessão, fila e limites ficam no Redis) e confira o limite de conexões do banco.

## Acesso só pelo site

Com `EDGE_SECRET` definido **na API (Railway) e no site (Vercel)** com o mesmo valor, o proxy do site carimba cada chamada para a API com esse segredo e com o IP real do visitante (que a Vercel conhece e não deixa forjar). A API recusa qualquer chamada sem o carimbo — por exemplo, direto no domínio `*.up.railway.app` —, então ninguém consegue escolher o próprio IP para furar os limites (pedidos, cupons, código do 1 clique, antifraude). Ficam abertos só `/health` e `/webhooks/*` (os gateways chamam direto, com assinatura própria). Sem `EDGE_SECRET` (desenvolvimento, CI, teste de carga), a API confia em `X-Forwarded-For` como antes. Teste: `apps/api/scripts/edge.test.mjs`.

## Pendências antes de produção

- **Gateway real**: chaves de teste da Pagar.me para validar o adaptador contra o ambiente deles antes de produção. Afiliados e coprodutores também precisam de identidade + conta bancária para receber a parte deles na Pagar.me.
- **Vídeo**: o armazenamento é local com URLs assinadas; trocar por Bunny/Cloudflare Stream e R2/S3 (bucket KYC separado).
- **Credenciais**: Resend (`RESEND_API_KEY`), Domma Chat (`DOMMA_CHAT_URL`/`TOKEN`), Cloudflare Turnstile (`TURNSTILE_SECRET`/`TURNSTILE_SITE_KEY`), KMS para as chaves de campo, cofre de segredos.
- **Não implementado no MVP**: ajuste manual de ledger com aprovação de 2 pessoas (RN-38), consulta automática à Receita no KYC, antivírus de upload, emissão de nota fiscal, recursos da Fase 2/3.
- **Jurídico/contábil** (seção 12): termos, privacidade, enquadramento regulatório e impostos.
- **Revisão humana sênior + pentest** dos módulos de pagamento, ledger e segurança (seções 15 e 16).
