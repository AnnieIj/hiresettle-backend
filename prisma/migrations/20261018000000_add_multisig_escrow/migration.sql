-- Migration: add_multisig_escrow
-- Adds support for multisig company escrow accounts (#495): a signer set +
-- threshold per company escrow account, and pending transactions that
-- collect one signature row per signer until the threshold is met.

CREATE TYPE "MultisigTxStatus" AS ENUM ('PENDING', 'SUBMITTED', 'FAILED');

CREATE TABLE "company_escrow_signer_sets" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "companyId"       TEXT        NOT NULL,
  "escrowAccountId" TEXT        NOT NULL,
  "threshold"       INTEGER     NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_escrow_signer_sets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_escrow_signer_sets_companyId_escrowAccountId_key"
  ON "company_escrow_signer_sets"("companyId", "escrowAccountId");
CREATE INDEX "company_escrow_signer_sets_companyId_idx"
  ON "company_escrow_signer_sets"("companyId");

ALTER TABLE "company_escrow_signer_sets"
  ADD CONSTRAINT "company_escrow_signer_sets_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "company_escrow_signers" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "signerSetId" TEXT        NOT NULL,
  "publicKey"   TEXT        NOT NULL,
  "userId"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "company_escrow_signers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_escrow_signers_signerSetId_publicKey_key"
  ON "company_escrow_signers"("signerSetId", "publicKey");
CREATE INDEX "company_escrow_signers_signerSetId_idx"
  ON "company_escrow_signers"("signerSetId");

ALTER TABLE "company_escrow_signers"
  ADD CONSTRAINT "company_escrow_signers_signerSetId_fkey"
  FOREIGN KEY ("signerSetId") REFERENCES "company_escrow_signer_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "multisig_pending_transactions" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "signerSetId"     TEXT        NOT NULL,
  "unsignedXdr"     TEXT        NOT NULL,
  "description"     TEXT,
  "status"          "MultisigTxStatus" NOT NULL DEFAULT 'PENDING',
  "submittedTxHash" TEXT,
  "errorMessage"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "multisig_pending_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "multisig_pending_transactions_signerSetId_idx"
  ON "multisig_pending_transactions"("signerSetId");
CREATE INDEX "multisig_pending_transactions_status_idx"
  ON "multisig_pending_transactions"("status");

ALTER TABLE "multisig_pending_transactions"
  ADD CONSTRAINT "multisig_pending_transactions_signerSetId_fkey"
  FOREIGN KEY ("signerSetId") REFERENCES "company_escrow_signer_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "multisig_signatures" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "pendingTxId" TEXT        NOT NULL,
  "signerId"    TEXT        NOT NULL,
  "signedXdr"   TEXT        NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "multisig_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "multisig_signatures_pendingTxId_signerId_key"
  ON "multisig_signatures"("pendingTxId", "signerId");
CREATE INDEX "multisig_signatures_pendingTxId_idx"
  ON "multisig_signatures"("pendingTxId");

ALTER TABLE "multisig_signatures"
  ADD CONSTRAINT "multisig_signatures_pendingTxId_fkey"
  FOREIGN KEY ("pendingTxId") REFERENCES "multisig_pending_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "multisig_signatures"
  ADD CONSTRAINT "multisig_signatures_signerId_fkey"
  FOREIGN KEY ("signerId") REFERENCES "company_escrow_signers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
