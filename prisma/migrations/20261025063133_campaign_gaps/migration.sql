-- AlterTable
ALTER TABLE "CampaignMessage" ADD COLUMN     "variant" TEXT;

-- AlterTable
ALTER TABLE "SendingIdentity" ADD COLUMN     "imapFolder" TEXT NOT NULL DEFAULT 'INBOX',
ADD COLUMN     "imapHost" TEXT,
ADD COLUMN     "imapLastCheckAt" TIMESTAMP(3),
ADD COLUMN     "imapLastError" TEXT,
ADD COLUMN     "imapPass" TEXT,
ADD COLUMN     "imapPort" INTEGER,
ADD COLUMN     "imapSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imapUser" TEXT;

-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "subjectB" TEXT;
