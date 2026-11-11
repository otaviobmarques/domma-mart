-- Upsell e downsell com 1 clique na página de obrigado
ALTER TABLE "offers" ADD COLUMN "upsell_offer_id" UUID;
ALTER TABLE "offers" ADD COLUMN "upsell_headline" TEXT;
ALTER TABLE "offers" ADD COLUMN "upsell_text" TEXT;
ALTER TABLE "offers" ADD COLUMN "downsell_offer_id" UUID;
ALTER TABLE "offers" ADD COLUMN "downsell_headline" TEXT;
ALTER TABLE "offers" ADD COLUMN "downsell_text" TEXT;
ALTER TABLE "orders" ADD COLUMN "parent_order_id" UUID;
ALTER TABLE "orders" ADD COLUMN "funnel_step" TEXT;
-- no máximo um upsell e um downsell por compra (e o mesmo clique duas vezes não cobra duas vezes)
CREATE UNIQUE INDEX "orders_parent_order_id_funnel_step_key" ON "orders"("parent_order_id", "funnel_step");
