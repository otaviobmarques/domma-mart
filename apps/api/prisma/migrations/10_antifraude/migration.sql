-- Antifraude com regras e pontuação (Fase 2)
CREATE TABLE "risk_config" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updated_by" UUID,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "risk_assessments" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  "order_id" UUID,
  "workspace_id" UUID NOT NULL,
  "offer_id" UUID NOT NULL,
  "method" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "score" INTEGER NOT NULL,
  "gateway_score" INTEGER,
  "decision" TEXT NOT NULL,
  "signals" JSONB NOT NULL,
  "doc_hash" TEXT,
  "email_hash" TEXT,
  "ip_hash" TEXT,
  "device" TEXT,
  "review_status" TEXT,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMPTZ,
  "review_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "risk_assessments_order_id_key" ON "risk_assessments"("order_id");
CREATE INDEX "risk_assessments_review_status_created_at_idx" ON "risk_assessments"("review_status", "created_at");
CREATE INDEX "risk_assessments_created_at_idx" ON "risk_assessments"("created_at");

CREATE TABLE "risk_alerts" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  "kind" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "workspace_id" UUID,
  "offer_id" UUID,
  "message" TEXT NOT NULL,
  "data" JSONB,
  "dedupe_key" TEXT,
  "acknowledged_by" UUID,
  "acknowledged_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "risk_alerts_dedupe_key_key" ON "risk_alerts"("dedupe_key");
CREATE INDEX "risk_alerts_acknowledged_at_created_at_idx" ON "risk_alerts"("acknowledged_at", "created_at");

ALTER TABLE "workspaces" ADD COLUMN "reserve_days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "workspaces" ADD COLUMN "payouts_paused_at" TIMESTAMPTZ;
ALTER TABLE "workspaces" ADD COLUMN "payouts_paused_reason" TEXT;
ALTER TABLE "blocklist" ADD COLUMN "label" TEXT;
