-- Relatórios de retenção, LTV e cancelamento (Fase 2): quando e por que cada assinatura terminou
ALTER TABLE "subscriptions" ADD COLUMN "cancel_requested_at" TIMESTAMPTZ;
ALTER TABLE "subscriptions" ADD COLUMN "ended_at" TIMESTAMPTZ;
ALTER TABLE "subscriptions" ADD COLUMN "end_reason" TEXT;
-- assinaturas que já terminaram: melhor estimativa é a última atualização
UPDATE "subscriptions" SET "ended_at" = "updated_at", "end_reason" = CASE WHEN "status" = 'defaulted' THEN 'payment_failed' ELSE 'voluntary' END
  WHERE "status" IN ('canceled', 'defaulted') AND "ended_at" IS NULL;
UPDATE "subscriptions" SET "cancel_requested_at" = "updated_at" WHERE "cancel_at_period_end" AND "cancel_requested_at" IS NULL;
CREATE INDEX "subscriptions_workspace_id_created_at_idx" ON "subscriptions"("workspace_id", "created_at");
CREATE INDEX "orders_workspace_id_paid_at_idx" ON "orders"("workspace_id", "paid_at");
