-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('brevo_shared', 'smtp');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('scheduled', 'sending', 'sent', 'bounced', 'failed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('sent', 'delivered', 'bounced', 'opened', 'clicked', 'replied', 'unsubscribed', 'complained', 'blocked');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('unsubscribe', 'hard_bounce', 'complaint', 'manual', 'global_optout');

-- CreateTable
CREATE TABLE "SendingIdentity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL DEFAULT 'brevo_shared',
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "replyToEmail" TEXT,
    "physicalAddress" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "dkimDomain" TEXT,
    "dkimSelector" TEXT,
    "dkimPrivateKey" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "perDomainHourlyCap" INTEGER NOT NULL DEFAULT 5,
    "warmupStartedAt" TIMESTAMP(3),
    "sandboxOnly" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendingIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "segmentId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "sendStartHour" INTEGER NOT NULL DEFAULT 9,
    "sendEndHour" INTEGER NOT NULL DEFAULT 17,
    "weekdaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "aiPersonalise" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'scheduled',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SendingIdentity_businessId_idx" ON "SendingIdentity"("businessId");

-- CreateIndex
CREATE INDEX "Segment_businessId_idx" ON "Segment"("businessId");

-- CreateIndex
CREATE INDEX "Campaign_businessId_status_idx" ON "Campaign"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_campaignId_key" ON "Sequence"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_position_key" ON "SequenceStep"("sequenceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_token_key" ON "CampaignMessage"("token");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_messageId_key" ON "CampaignMessage"("messageId");

-- CreateIndex
CREATE INDEX "CampaignMessage_businessId_status_scheduledFor_idx" ON "CampaignMessage"("businessId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessage_campaignId_leadId_stepId_key" ON "CampaignMessage"("campaignId", "leadId", "stepId");

-- CreateIndex
CREATE INDEX "Suppression_email_idx" ON "Suppression"("email");

-- CreateIndex
CREATE INDEX "EmailEvent_businessId_campaignId_type_idx" ON "EmailEvent"("businessId", "campaignId", "type");

-- CreateIndex
CREATE INDEX "EmailEvent_messageId_idx" ON "EmailEvent"("messageId");

-- AddForeignKey
ALTER TABLE "SendingIdentity" ADD CONSTRAINT "SendingIdentity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "SendingIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CampaignMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the email-campaign tables (same two-layer pattern as the rest of the
-- schema: app-level scoping plus a database backstop).

ALTER TABLE "SendingIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SendingIdentity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SendingIdentity"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "Segment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Segment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Segment"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Campaign"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "Sequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Sequence"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "SequenceStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SequenceStep" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SequenceStep"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "EmailEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailEvent"
  USING ("businessId" = current_setting('app.business_id', true));

-- The unsubscribe page, open/click tracking and the inbound-mail endpoint have no session. They
-- resolve ONE message by its unguessable token, or by the Message-ID we sent with, and nothing else.
ALTER TABLE "CampaignMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CampaignMessage"
  USING (
    "businessId" = current_setting('app.business_id', true)
    OR "token" = current_setting('app.message_token', true)
    OR "messageId" = current_setting('app.message_id', true)
  );

-- Platform-wide suppressions (businessId NULL) are visible to every tenant so a hard bounce or a
-- never-email-me request protects everyone; a business also sees its own.
ALTER TABLE "Suppression" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Suppression" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Suppression"
  USING (
    "businessId" IS NULL
    OR "businessId" = current_setting('app.business_id', true)
  );

-- One suppression per (scope, address); addresses are stored lower-case.
CREATE UNIQUE INDEX "Suppression_scope_email_key"
  ON "Suppression" (COALESCE("businessId", '__global__'), lower("email"));
