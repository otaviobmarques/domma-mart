-- API pública (Fase 2): chaves por conta, com permissões
CREATE TABLE "api_keys" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_used_at" TIMESTAMPTZ,
  "last_used_ip_hash" TEXT,
  "revoked_at" TIMESTAMPTZ,
  "revoked_by" UUID
);
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");
CREATE INDEX "api_keys_workspace_id_idx" ON "api_keys"("workspace_id");
-- webhook criado pela API (ex.: Zapier/n8n) guarda a chave que o criou
ALTER TABLE "webhook_endpoints" ADD COLUMN "api_key_id" UUID;
