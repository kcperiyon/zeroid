/*
  Warnings:

  - Added the required column `organizationId` to the `WhatsAppConnection` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WhatsAppConnection" ADD COLUMN     "organizationId" TEXT NOT NULL;
