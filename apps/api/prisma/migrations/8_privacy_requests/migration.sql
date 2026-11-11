-- Portal de direitos do titular (LGPD art. 18)
CREATE TABLE "privacy_requests" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "subject_type" TEXT NOT NULL,
  "subject_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "retain_until" TIMESTAMPTZ,
  "resolution" TEXT,
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "privacy_requests_status_created_at_idx" ON "privacy_requests"("status", "created_at");
CREATE INDEX "privacy_requests_subject_type_subject_id_idx" ON "privacy_requests"("subject_type", "subject_id");
