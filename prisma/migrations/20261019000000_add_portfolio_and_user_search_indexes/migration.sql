-- Migration: add_portfolio_and_user_search_indexes
-- #474 — adds indexes on users(email), users(stellarAddress), users(company)
--        to support fast admin user search.
-- #504 — adds recruiter_portfolio_entries table for recruiter past placements.

-- #474: Indexes for admin user search (email, Stellar address, company name)
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_stellarAddress_idx" ON "users"("stellarAddress");
CREATE INDEX IF NOT EXISTS "users_company_idx" ON "users"("company");

-- #504: Recruiter portfolio of past placements
CREATE TABLE "recruiter_portfolio_entries" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "recruiterId" TEXT        NOT NULL,
  "role"        TEXT        NOT NULL,
  "industry"    TEXT        NOT NULL,
  "year"        INTEGER     NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "recruiter_portfolio_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recruiter_portfolio_entries_recruiterId_fkey"
    FOREIGN KEY ("recruiterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "recruiter_portfolio_entries_recruiterId_idx"
  ON "recruiter_portfolio_entries"("recruiterId");
