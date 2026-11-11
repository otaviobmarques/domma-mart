-- Domínio próprio do produtor (5.3)
CREATE TABLE "custom_domains" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dns" JSONB,
    "last_error" TEXT,
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "custom_domains_hostname_key" ON "custom_domains"("hostname");
CREATE INDEX "custom_domains_workspace_id_idx" ON "custom_domains"("workspace_id");
