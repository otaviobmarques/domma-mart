# Adaptadores de gateway

Implementados: `sandbox` (testes) e `pagarme` (Pagar.me API v5 — veja o README da raiz, seção *Gateway Pagar.me*).

O sistema só conhece a interface `GatewayAdapter` (`gateway.types.ts`). Para ligar um gateway real
(decisão D1 — Asaas, Pagar.me ou Mercado Pago):

1. Crie `asaas.adapter.ts` (por exemplo) implementando `createSubaccount`, `createCharge` (com split por
   subconta), `getCharge`, `refund`, `transfer`, `parseWebhook` (validação da assinatura do provedor) e `settlements`.
2. Registre-o em `gatewayFactory()` (`src/app.module.ts`) e use `GATEWAY_PROVIDER=asaas`.
3. No front, troque `apps/web/lib/tokenizer.ts` pelo SDK/JS de tokenização do provedor — o número do
   cartão nunca pode chegar à API da Domma (P4 / RN-63). Atualize a CSP em `next.config.mjs`.
4. Na renovação de assinaturas (`jobs.service.ts → renewSubscription`), use o `card_token_ref` salvo
   em vez do token de sandbox.

Requisitos para aprovar o gateway (seção 25.4): subcontas, split, tokenização no navegador, Pix com
webhook em tempo real, reembolso parcial e transferência Pix por API.
