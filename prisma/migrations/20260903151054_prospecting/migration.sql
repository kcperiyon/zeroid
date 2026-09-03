-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('new', 'imported', 'dismissed');

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "LeadChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "category" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_leadId_key" ON "Prospect"("leadId");

-- CreateIndex
CREATE INDEX "Prospect_businessId_idx" ON "Prospect"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_businessId_channel_externalId_key" ON "Prospect"("businessId", "channel", "externalId");

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
