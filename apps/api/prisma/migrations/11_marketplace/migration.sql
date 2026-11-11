-- Marketplace de afiliados (Fase 2)
ALTER TABLE "products" ADD COLUMN "marketplace_listed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN "category" TEXT;
ALTER TABLE "products" ADD COLUMN "affiliate_rules" TEXT;
ALTER TABLE "products" ADD COLUMN "marketplace_delisted_at" TIMESTAMPTZ;
ALTER TABLE "products" ADD COLUMN "marketplace_delisted_reason" TEXT;
CREATE INDEX "products_marketplace_listed_category_idx" ON "products"("marketplace_listed", "category");

-- comissão por oferta (vazio = a do produto)
ALTER TABLE "offers" ADD COLUMN "affiliate_commission_bps" INTEGER;

-- pedido de afiliação com mensagem do afiliado e resposta do produtor
ALTER TABLE "affiliations" ADD COLUMN "message" TEXT;
ALTER TABLE "affiliations" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'invite';
ALTER TABLE "affiliations" ADD COLUMN "decided_at" TIMESTAMPTZ;
CREATE INDEX "affiliations_affiliate_workspace_id_idx" ON "affiliations"("affiliate_workspace_id");

CREATE TABLE "affiliate_materials" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  "product_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "body" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "affiliate_materials_product_id_idx" ON "affiliate_materials"("product_id");
