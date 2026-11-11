-- Gateway Pagar.me: dados extras do recebedor e saque para conta bancária
ALTER TABLE "kyc_submissions" ADD COLUMN "extra_enc" BYTEA;
ALTER TABLE "payout_accounts" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'pix';
ALTER TABLE "payout_accounts" ADD COLUMN "bank_enc" BYTEA;
ALTER TABLE "payout_accounts" ALTER COLUMN "pix_key_enc" DROP NOT NULL;
