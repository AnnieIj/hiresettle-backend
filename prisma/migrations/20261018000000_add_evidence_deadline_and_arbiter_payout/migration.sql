-- Migration: add_evidence_deadline_and_arbiter_payout
-- #499: evidence submission deadlines per dispute.
-- #500: arbiter fee configuration and payout recording.

-- New notification type for the evidence-window-closing reminder
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISPUTE_EVIDENCE_WINDOW_CLOSING';

-- Evidence submission deadline fields on Dispute (#499)
ALTER TABLE "disputes" ADD COLUMN "evidenceDeadline" TIMESTAMP(3);
ALTER TABLE "disputes" ADD COLUMN "evidenceDeadlineWarnedAt" TIMESTAMP(3);

CREATE INDEX "disputes_status_evidenceDeadline_idx" ON "disputes"("status", "evidenceDeadline");

-- Arbiter payout table (#500)
CREATE TABLE "arbiter_payouts" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid(),
  "disputeId" TEXT         NOT NULL,
  "arbiterId" TEXT         NOT NULL,
  "feeType"   TEXT         NOT NULL,
  "feeValue"  DECIMAL(65,30) NOT NULL,
  "amount"    BIGINT       NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "arbiter_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "arbiter_payouts_disputeId_key" ON "arbiter_payouts"("disputeId");
CREATE INDEX "arbiter_payouts_arbiterId_idx" ON "arbiter_payouts"("arbiterId");

ALTER TABLE "arbiter_payouts" ADD CONSTRAINT "arbiter_payouts_arbiterId_fkey"
  FOREIGN KEY ("arbiterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
