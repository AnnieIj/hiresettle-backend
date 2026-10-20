-- Migration: issues #478 (email bounce suppression), #479 (member spending limits),
--            #489 (SAML/OIDC SSO), #494 (SEP-10 Stellar Web Authentication)

-- ── Issue #479: spending limit already added to company_members in schema ──────────────────────
-- The spendingLimit column was included in a previous migration.  This migration
-- adds the remaining models for the other three issues.

-- ── Issue #478: suppressed emails ───────────────────────────────────────────────────────────────
CREATE TYPE "EmailSuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT');

CREATE TABLE "suppressed_emails" (
    "id"        TEXT        NOT NULL,
    "email"     TEXT        NOT NULL,
    "reason"    "EmailSuppressionReason" NOT NULL,
    "sourceId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppressed_emails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppressed_emails_email_key" ON "suppressed_emails"("email");
CREATE INDEX "suppressed_emails_email_idx" ON "suppressed_emails"("email");

-- ── Issue #494: SEP-10 challenges ───────────────────────────────────────────────────────────────
CREATE TABLE "sep10_challenges" (
    "id"        TEXT        NOT NULL,
    "account"   TEXT        NOT NULL,
    "nonce"     TEXT        NOT NULL,
    "xdr"       TEXT        NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sep10_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sep10_challenges_nonce_key" ON "sep10_challenges"("nonce");
CREATE INDEX "sep10_challenges_account_idx" ON "sep10_challenges"("account");

-- ── Issue #489: company SSO configuration ───────────────────────────────────────────────────────
CREATE TYPE "SsoProtocol" AS ENUM ('OIDC', 'SAML');

CREATE TABLE "company_sso_configs" (
    "id"           TEXT        NOT NULL,
    "companyId"    TEXT        NOT NULL,
    "protocol"     "SsoProtocol" NOT NULL DEFAULT 'OIDC',
    "issuer"       TEXT        NOT NULL,
    "clientId"     TEXT,
    "clientSecret" TEXT,
    "metadataUrl"  TEXT,
    "defaultRole"  TEXT,
    "isEnabled"    BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_sso_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_sso_configs_companyId_key" ON "company_sso_configs"("companyId");
CREATE INDEX "company_sso_configs_companyId_idx" ON "company_sso_configs"("companyId");

ALTER TABLE "company_sso_configs"
    ADD CONSTRAINT "company_sso_configs_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
