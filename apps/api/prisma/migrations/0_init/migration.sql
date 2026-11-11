CREATE EXTENSION IF NOT EXISTS citext;

-- UUID v7 (ordenável por tempo) — seção 7
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes := unix_ts_ms || substring(uuid_send(gen_random_uuid()) from 1 for 10); -- gen_random_uuid é nativo (PG13+), sem pgcrypto
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  uuid_bytes := set_byte(uuid_bytes, 8, (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('none', 'support', 'compliance', 'finance', 'super_admin');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'blocked');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('pf', 'pj');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('course', 'file', 'service', 'subscription');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('draft', 'approved', 'in_review', 'rejected');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('one_time', 'subscription');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('month', 'quarter', 'semester', 'year');

-- CreateEnum
CREATE TYPE "InterestMode" AS ENUM ('buyer', 'producer');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('draft', 'active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('created', 'pending', 'paid', 'refund_requested', 'refunded', 'chargeback', 'chargeback_won', 'chargeback_lost', 'expired', 'failed', 'abandoned');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('pix', 'card', 'boleto');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_enc" BYTEA,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ,
    "totp_secret_enc" BYTEA,
    "totp_enabled_at" TIMESTAMPTZ,
    "otp_failed" INTEGER NOT NULL DEFAULT 0,
    "otp_locked_until" TIMESTAMPTZ,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'none',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'producer',
    "user_agent" TEXT,
    "ip_hash" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "person_type" "PersonType",
    "document_enc" BYTEA,
    "document_hash" TEXT,
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'pending',
    "gateway_subaccount_id" TEXT,
    "custom_fee_bps" INTEGER,
    "daily_withdraw_limit" BIGINT NOT NULL DEFAULT 5000000,
    "reserve_pct" INTEGER NOT NULL DEFAULT 0,
    "blocked_at" TIMESTAMPTZ,
    "blocked_reason" TEXT,
    "support_whatsapp" TEXT,
    "support_email" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_submissions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "person_type" "PersonType" NOT NULL,
    "name" TEXT NOT NULL,
    "document_enc" BYTEA NOT NULL,
    "document_last4" TEXT NOT NULL,
    "birth_date" TEXT,
    "partner_name" TEXT,
    "doc_front_key" TEXT,
    "doc_back_key" TEXT,
    "selfie_key" TEXT,
    "auto_checks" JSONB NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'low',
    "status" "KycStatus" NOT NULL DEFAULT 'in_review',
    "decided_by" UUID,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "pix_key_enc" BYTEA NOT NULL,
    "pix_key_mask" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "holder_doc_hash" TEXT NOT NULL,
    "active_from" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "type" "ProductType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cover_url" TEXT,
    "service_url" TEXT,
    "moderation_status" "ModerationStatus" NOT NULL DEFAULT 'draft',
    "moderation_notes" TEXT,
    "guarantee_days" INTEGER NOT NULL DEFAULT 7,
    "affiliation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "affiliation_auto_approve" BOOLEAN NOT NULL DEFAULT true,
    "affiliate_commission_bps" INTEGER NOT NULL DEFAULT 3000,
    "affiliate_cookie_days" INTEGER NOT NULL DEFAULT 60,
    "affiliate_attribution" TEXT NOT NULL DEFAULT 'last_click',
    "published_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Padrão',
    "price_cents" BIGINT NOT NULL,
    "billing_type" "BillingType" NOT NULL DEFAULT 'one_time',
    "interval" "BillingInterval",
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "max_installments" INTEGER NOT NULL DEFAULT 12,
    "installment_interest" "InterestMode" NOT NULL DEFAULT 'buyer',
    "methods" TEXT[] DEFAULT ARRAY['pix', 'card']::TEXT[],
    "guarantee_days" INTEGER NOT NULL DEFAULT 7,
    "sales_limit" INTEGER,
    "ends_at" TIMESTAMPTZ,
    "pix_expiration_min" INTEGER NOT NULL DEFAULT 30,
    "boleto_due_days" INTEGER NOT NULL DEFAULT 3,
    "thank_you_url" TEXT,
    "theme" JSONB,
    "status" "OfferStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_bumps" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "offer_id" UUID NOT NULL,
    "bump_offer_id" UUID NOT NULL,
    "headline" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_bumps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "offer_ids" UUID[],
    "affiliate_workspace_id" UUID,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "max_uses" INTEGER,
    "max_uses_per_cpf" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coproductions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "invited_email" CITEXT NOT NULL,
    "share_bps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "ends_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "coproductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "module_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'video',
    "body" TEXT,
    "storage_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "duration_sec" INTEGER,
    "drip_days" INTEGER,
    "drip_date" TIMESTAMPTZ,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_files" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "received" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customer_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position_sec" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "student_name" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playback_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "customer_session_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "playback_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document_enc" BYTEA NOT NULL,
    "document_hash" TEXT NOT NULL,
    "phone_enc" BYTEA NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "marketing_consent" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_auth_tokens" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customer_id" UUID,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customer_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_leads" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT,
    "phone_enc" BYTEA,
    "converted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "checkout_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_views" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "tracking" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'created',
    "method" "PaymentMethod" NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "subtotal_cents" BIGINT NOT NULL,
    "discount_cents" BIGINT NOT NULL DEFAULT 0,
    "interest_cents" BIGINT NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL,
    "coupon_id" UUID,
    "affiliate_workspace_id" UUID,
    "subscription_id" UUID,
    "tracking" JSONB,
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "device_fingerprint" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "purchase_event_sent_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "refunded_at" TIMESTAMPTZ,
    "guarantee_ends_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "price_cents" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "event" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_charge_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" TEXT NOT NULL,
    "raw_status" TEXT NOT NULL,
    "decline_code" TEXT,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "card_token_ref" TEXT,
    "pix_qr" TEXT,
    "pix_copy_paste" TEXT,
    "pix_expires_at" TIMESTAMPTZ,
    "boleto_url" TEXT,
    "boleto_line" TEXT,
    "boleto_due_at" TIMESTAMPTZ,
    "risk_score" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "splits" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "beneficiary_type" TEXT NOT NULL,
    "beneficiary_id" UUID,
    "amount_cents" BIGINT NOT NULL,
    "rule" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT,
    "amount_cents" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "provider_refund_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "price_cents" BIGINT NOT NULL,
    "card_token_ref" TEXT,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "current_period_end" TIMESTAMPTZ NOT NULL,
    "next_charge_at" TIMESTAMPTZ,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "provider_subscription_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "transaction_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID,
    "bucket" TEXT NOT NULL,
    "debit_cents" BIGINT NOT NULL DEFAULT 0,
    "credit_cents" BIGINT NOT NULL DEFAULT 0,
    "reference_type" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "available_at" TIMESTAMPTZ NOT NULL,
    "description" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "destination_enc" BYTEA NOT NULL,
    "destination_mask" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "otp_verified_at" TIMESTAMPTZ NOT NULL,
    "provider_transfer_id" TEXT,
    "failure_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "producer_workspace_id" UUID NOT NULL,
    "affiliate_workspace_id" UUID NOT NULL,
    "affiliate_user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_clicks" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "affiliation_id" UUID NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_bindings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "customer_key" TEXT NOT NULL,
    "affiliation_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliate_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events_in" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_in_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret_enc" BYTEA NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "disabled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "endpoint_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ,
    "next_attempt_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID,
    "channel" TEXT NOT NULL,
    "to_masked" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "ref_type" TEXT,
    "ref_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_settings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "workspace_id" UUID NOT NULL,
    "pix_unpaid" BOOLEAN NOT NULL DEFAULT true,
    "boleto_unpaid" BOOLEAN NOT NULL DEFAULT true,
    "card_declined" BOOLEAN NOT NULL DEFAULT true,
    "abandoned" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "delays_min" INTEGER[] DEFAULT ARRAY[15, 120, 1440]::INTEGER[],
    "template" TEXT NOT NULL DEFAULT '{nome}, seu pedido de {produto} ainda está esperando. Termine aqui: {link}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recovery_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opt_outs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB,
    "status_code" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "blocklist" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "kind" TEXT NOT NULL,
    "value_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "offer_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "seq" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_hash" TEXT,
    "reason" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_tiers_cache" (
    "workspace_id" UUID NOT NULL,
    "revenue_30d" BIGINT NOT NULL,
    "fee_bps" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fee_tiers_cache_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_workspace_id_key" ON "memberships"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "kyc_submissions_status_created_at_idx" ON "kyc_submissions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payout_accounts_workspace_id_key" ON "payout_accounts"("workspace_id");

-- CreateIndex
CREATE INDEX "products_workspace_id_idx" ON "products"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_slug_key" ON "offers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "offer_bumps_offer_id_bump_offer_id_key" ON "offer_bumps"("offer_id", "bump_offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_workspace_id_code_key" ON "coupons"("workspace_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_customer_id_lesson_id_key" ON "lesson_progress"("customer_id", "lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_code_key" ON "certificates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_customer_id_product_id_key" ON "certificates"("customer_id", "product_id");

-- CreateIndex
CREATE INDEX "playback_sessions_customer_id_product_id_idx" ON "playback_sessions"("customer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "playback_sessions_customer_session_id_product_id_key" ON "playback_sessions"("customer_session_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_document_hash_idx" ON "customers"("document_hash");

-- CreateIndex
CREATE INDEX "customers_phone_hash_idx" ON "customers"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "customer_auth_tokens_token_hash_key" ON "customer_auth_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_leads_offer_id_email_key" ON "checkout_leads"("offer_id", "email");

-- CreateIndex
CREATE INDEX "checkout_views_workspace_id_created_at_idx" ON "checkout_views"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_workspace_id_created_at_idx" ON "orders"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_charge_id_key" ON "payments"("provider_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_order_item_id_key" ON "enrollments"("order_item_id");

-- CreateIndex
CREATE INDEX "enrollments_customer_id_product_id_idx" ON "enrollments"("customer_id", "product_id");

-- CreateIndex
CREATE INDEX "ledger_entries_owner_type_owner_id_bucket_available_at_idx" ON "ledger_entries"("owner_type", "owner_id", "bucket", "available_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_type_reference_id_idx" ON "ledger_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_idempotency_key_key" ON "withdrawals"("idempotency_key");

-- CreateIndex
CREATE INDEX "withdrawals_workspace_id_created_at_idx" ON "withdrawals"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliations_code_key" ON "affiliations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "affiliations_product_id_affiliate_workspace_id_key" ON "affiliations"("product_id", "affiliate_workspace_id");

-- CreateIndex
CREATE INDEX "affiliate_clicks_affiliation_id_created_at_idx" ON "affiliate_clicks"("affiliation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_bindings_product_id_customer_key_key" ON "affiliate_bindings"("product_id", "customer_key");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_in_provider_event_id_key" ON "webhook_events_in"("provider", "event_id");

-- CreateIndex
CREATE INDEX "notifications_ref_type_ref_id_idx" ON "notifications"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_settings_workspace_id_key" ON "recovery_settings"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "opt_outs_key_hash_key" ON "opt_outs"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "blocklist_kind_value_hash_key" ON "blocklist"("kind", "value_hash");

-- CreateIndex
CREATE INDEX "risk_events_kind_key_created_at_idx" ON "risk_events"("kind", "key", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_idx" ON "audit_logs"("target");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_bumps" ADD CONSTRAINT "offer_bumps_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_files" ADD CONSTRAINT "product_files_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "splits" ADD CONSTRAINT "splits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

