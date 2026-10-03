-- CreateEnum
CREATE TYPE "LeadMedium" AS ENUM ('organic', 'paid');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "campaign" TEXT,
ADD COLUMN     "medium" "LeadMedium" NOT NULL DEFAULT 'organic';

-- CreateTable
CREATE TABLE "IntakeKey" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT,
    "instagramAccountId" TEXT,
    "pageAccessToken" TEXT NOT NULL,
    "subscribed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeKey_businessId_key" ON "IntakeKey"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeKey_publicKey_key" ON "IntakeKey"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_businessId_key" ON "MetaConnection"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_pageId_key" ON "MetaConnection"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaConnection_instagramAccountId_key" ON "MetaConnection"("instagramAccountId");

-- AddForeignKey
ALTER TABLE "IntakeKey" ADD CONSTRAINT "IntakeKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security. Both tables are looked up by a public identifier before
-- any business/session context exists (the intake form posts a public key;
-- Meta's webhook carries only a Page/IG account id), so each policy has a
-- narrow self-lookup clause in addition to the usual business scope --
-- same pattern as Invite (token) and WhatsAppConnection (phone number id).
ALTER TABLE "IntakeKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntakeKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntakeKey"
  USING (
    "businessId" = current_setting('app.business_id', true)
    OR "publicKey" = current_setting('app.intake_key', true)
  );

ALTER TABLE "MetaConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MetaConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MetaConnection"
  USING (
    "businessId" = current_setting('app.business_id', true)
    OR "pageId" = current_setting('app.meta_account_id', true)
    OR "instagramAccountId" = current_setting('app.meta_account_id', true)
  );
