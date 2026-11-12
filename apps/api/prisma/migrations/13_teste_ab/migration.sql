-- Teste A/B do checkout (Fase 2): duas ofertas do mesmo produto disputam o mesmo link de venda
CREATE TABLE "checkout_experiments" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  "workspace_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "control_offer_id" UUID NOT NULL,
  "variant_offer_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "split_pct" INTEGER NOT NULL DEFAULT 50,
  "metric" TEXT NOT NULL DEFAULT 'conversion',
  "status" TEXT NOT NULL DEFAULT 'running',
  "winner" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ended_at" TIMESTAMPTZ,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "checkout_experiments_control_offer_id_status_idx" ON "checkout_experiments"("control_offer_id", "status");
CREATE INDEX "checkout_experiments_workspace_id_idx" ON "checkout_experiments"("workspace_id");

ALTER TABLE "checkout_views" ADD COLUMN "experiment_id" UUID;
ALTER TABLE "checkout_views" ADD COLUMN "variant" TEXT;
ALTER TABLE "checkout_views" ADD COLUMN "visitor" TEXT;
CREATE INDEX "checkout_views_experiment_id_variant_idx" ON "checkout_views"("experiment_id", "variant");

ALTER TABLE "orders" ADD COLUMN "experiment_id" UUID;
ALTER TABLE "orders" ADD COLUMN "experiment_variant" TEXT;
CREATE INDEX "orders_experiment_id_idx" ON "orders"("experiment_id");
