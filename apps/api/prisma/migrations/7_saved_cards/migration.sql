-- Compra com 1 clique: cartões guardados no gateway (referência cifrada, nunca o número)
CREATE TABLE "saved_cards" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "customer_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "token_ref_enc" BYTEA NOT NULL,
  "token_ref_hash" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  CONSTRAINT "saved_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saved_cards_customer_id_token_ref_hash_key" ON "saved_cards"("customer_id", "token_ref_hash");
CREATE INDEX "saved_cards_customer_id_idx" ON "saved_cards"("customer_id");
