-- Migration: add company tax profile to users (#506)
--
-- Country of establishment and VAT / tax registration number for COMPANY
-- accounts. Used to compute invoice VAT, apply the EU reverse charge to
-- cross-border B2B invoices, and print the customer's tax ID on invoice PDFs.

ALTER TABLE "users" ADD COLUMN "taxCountry" TEXT;
ALTER TABLE "users" ADD COLUMN "taxId" TEXT;
