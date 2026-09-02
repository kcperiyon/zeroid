-- CreateEnum
CREATE TYPE "CreditPurchaseStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateTable
CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "txRef" TEXT NOT NULL,
    "amountUsd" DECIMAL(10,2) NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" "CreditPurchaseStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchase_txRef_key" ON "CreditPurchase"("txRef");

-- CreateIndex
CREATE INDEX "CreditPurchase_organizationId_idx" ON "CreditPurchase"("organizationId");

-- AddForeignKey
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
