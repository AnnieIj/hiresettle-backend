-- AddValue: DISPUTE_MESSAGE_CREATED to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISPUTE_MESSAGE_CREATED';

-- CreateTable: dispute_messages — structured communication channel per dispute
CREATE TABLE "dispute_messages" (
    "id"                 TEXT         NOT NULL DEFAULT gen_random_uuid(),
    "disputeId"          TEXT         NOT NULL,
    "authorId"           TEXT         NOT NULL,
    "body"               TEXT         NOT NULL,
    "attachmentS3Key"    TEXT,
    "attachmentName"     TEXT,
    "attachmentSize"     INTEGER,
    "attachmentMimeType" TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_messages_disputeId_createdAt_idx" ON "dispute_messages"("disputeId", "createdAt");
CREATE INDEX "dispute_messages_authorId_idx"             ON "dispute_messages"("authorId");

-- AddForeignKey
ALTER TABLE "dispute_messages"
    ADD CONSTRAINT "dispute_messages_disputeId_fkey"
    FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispute_messages"
    ADD CONSTRAINT "dispute_messages_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
