-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadChannel" ADD VALUE 'osm';
ALTER TYPE "LeadChannel" ADD VALUE 'registry';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "emailConfidence" INTEGER,
ADD COLUMN     "researchNote" TEXT;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "bestEmailConfidence" INTEGER,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "discoveryJobId" TEXT,
ADD COLUMN     "domain" TEXT,
ADD COLUMN     "enrichAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enrichError" TEXT,
ADD COLUMN     "enrichStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "enrichedAt" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lon" DOUBLE PRECISION,
ADD COLUMN     "researchNote" TEXT,
ADD COLUMN     "signals" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "DiscoveryJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "industries" JSONB NOT NULL DEFAULT '[]',
    "locations" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "maxProspects" INTEGER NOT NULL DEFAULT 300,
    "maxCells" INTEGER NOT NULL DEFAULT 200,
    "autoEnrich" BOOLEAN NOT NULL DEFAULT true,
    "cellsTotal" INTEGER NOT NULL DEFAULT 0,
    "cellsDone" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DiscoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryCell" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "locationLabel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "south" DOUBLE PRECISION NOT NULL,
    "west" DOUBLE PRECISION NOT NULL,
    "north" DOUBLE PRECISION NOT NULL,
    "east" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectEmail" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "personName" TEXT,
    "mxOk" BOOLEAN,
    "catchAll" BOOLEAN,
    "smtp" TEXT NOT NULL DEFAULT 'unchecked',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryJob_businessId_status_idx" ON "DiscoveryJob"("businessId", "status");

-- CreateIndex
CREATE INDEX "DiscoveryCell_jobId_status_idx" ON "DiscoveryCell"("jobId", "status");

-- CreateIndex
CREATE INDEX "DiscoveryCell_status_source_idx" ON "DiscoveryCell"("status", "source");

-- CreateIndex
CREATE INDEX "ProspectEmail_businessId_confidence_idx" ON "ProspectEmail"("businessId", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectEmail_prospectId_email_key" ON "ProspectEmail"("prospectId", "email");

-- CreateIndex
CREATE INDEX "Prospect_businessId_domain_idx" ON "Prospect"("businessId", "domain");

-- CreateIndex
CREATE INDEX "Prospect_enrichStatus_businessId_idx" ON "Prospect"("enrichStatus", "businessId");

-- AddForeignKey
ALTER TABLE "DiscoveryJob" ADD CONSTRAINT "DiscoveryJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCell" ADD CONSTRAINT "DiscoveryCell_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCell" ADD CONSTRAINT "DiscoveryCell_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEmail" ADD CONSTRAINT "ProspectEmail_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEmail" ADD CONSTRAINT "ProspectEmail_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One prospect per company site per business. Partial, so prospects without a website are unaffected.
CREATE UNIQUE INDEX "Prospect_businessId_domain_key" ON "Prospect" ("businessId", lower("domain")) WHERE "domain" IS NOT NULL;

-- Row-level security for the discovery tables (same two-layer pattern as the rest of the schema).
ALTER TABLE "DiscoveryJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscoveryJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiscoveryJob"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "DiscoveryCell" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscoveryCell" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DiscoveryCell"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "ProspectEmail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProspectEmail" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProspectEmail"
  USING ("businessId" = current_setting('app.business_id', true));
