-- AlterEnum
ALTER TYPE "LeadChannel" ADD VALUE 'news';

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "sourceUrl" TEXT;
