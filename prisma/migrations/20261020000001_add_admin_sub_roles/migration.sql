-- CreateEnum: AdminSubRole — fine-grained permissions within the ADMIN user role
CREATE TYPE "AdminSubRole" AS ENUM ('SUPER_ADMIN', 'OPS', 'FINANCE', 'SUPPORT');

-- AlterTable: add nullable adminSubRole column to users
-- Null is intentional: existing admins default to SUPER_ADMIN behaviour at the
-- application layer without requiring a data migration.
ALTER TABLE "users" ADD COLUMN "adminSubRole" "AdminSubRole";
