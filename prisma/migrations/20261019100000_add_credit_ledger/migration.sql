-- Migration: prepaid credit ledger for companies (#507)
--
-- Append-only: every credit purchase, grant, fee deduction, reversal or
-- adjustment is a new row with the running balance snapshot. UPDATE and
-- DELETE are rejected by a trigger so the history cannot be rewritten.

-- CreateEnum
CREATE TYPE "CreditLedgerEntryType" AS ENUM ('PURCHASE', 'GRANT', 'FEE_DEDUCTION', 'REVERSAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "CreditLedgerEntryType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_ledger_amount_nonzero" CHECK ("amount" <> 0),
    CONSTRAINT "credit_ledger_balance_nonnegative" CHECK ("balanceAfter" >= 0),
    CONSTRAINT "credit_ledger_sequence_positive" CHECK ("sequence" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_companyId_sequence_key" ON "credit_ledger"("companyId", "sequence");
CREATE UNIQUE INDEX "credit_ledger_companyId_idempotencyKey_key" ON "credit_ledger"("companyId", "idempotencyKey");
CREATE INDEX "credit_ledger_companyId_createdAt_idx" ON "credit_ledger"("companyId", "createdAt");
CREATE INDEX "credit_ledger_reference_idx" ON "credit_ledger"("reference");

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only guard
CREATE OR REPLACE FUNCTION credit_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only; record a REVERSAL or ADJUSTMENT entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_append_only();
