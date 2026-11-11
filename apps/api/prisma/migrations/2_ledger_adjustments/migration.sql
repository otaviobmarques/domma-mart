-- RN-38: ajustes manuais exigem pedido + aprovação por outra pessoa
CREATE TABLE "ledger_adjustments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decision_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transaction_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "ledger_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_adjustments_amount_nonzero" CHECK ("amount_cents" <> 0),
    CONSTRAINT "ledger_adjustments_two_people" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by")
);
CREATE INDEX "ledger_adjustments_status_created_at_idx" ON "ledger_adjustments"("status", "created_at");
CREATE INDEX "ledger_adjustments_workspace_id_idx" ON "ledger_adjustments"("workspace_id");
