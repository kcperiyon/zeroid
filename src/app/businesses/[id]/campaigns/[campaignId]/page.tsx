import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { campaignStats, stepStats as loadStepStats } from "@/lib/email-campaigns/engine";
import { liveSendingEnabled } from "@/lib/email-campaigns/guard";
import { CampaignEditor } from "@/components/campaigns/campaign-editor";

export default async function CampaignPage({ params }: { params: Promise<{ id: string; campaignId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id: businessId, campaignId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const data = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, businessId },
      include: {
        segment: { select: { name: true } },
        identity: { select: { name: true, provider: true, sandboxOnly: true, fromEmail: true, fromName: true } },
        sequence: { include: { steps: { orderBy: { position: "asc" } } } },
      },
    });
    if (!campaign) return null;
    // Sequential on purpose: queries inside one transaction must not overlap.
    const stats = await campaignStats(tx, campaignId);
    const stepStats = await loadStepStats(tx, campaignId);
    const events = await tx.emailEvent.findMany({ where: { campaignId }, orderBy: { createdAt: "desc" }, take: 20, include: { message: { select: { toEmail: true } } } });
    return { campaign, stats, stepStats, events };
  });
  if (!data) notFound();
  const { campaign, stats, stepStats, events } = data;
  const sandboxed = campaign.identity.provider === "brevo_shared" || campaign.identity.sandboxOnly || !liveSendingEnabled();

  return (
    <div className="space-y-4">
      <Link href={`/businesses/${businessId}/campaigns`} className="text-sm text-neutral-500 hover:text-neutral-900">← All campaigns</Link>
      <CampaignEditor
        businessId={businessId}
        campaign={{
          id: campaign.id,
          name: campaign.name,
          objective: campaign.objective,
          status: campaign.status,
          segmentName: campaign.segment.name,
          identityName: campaign.identity.name,
          fromLabel: `${campaign.identity.fromName} <${campaign.identity.fromEmail}>`,
          timezone: campaign.timezone,
          sendStartHour: campaign.sendStartHour,
          sendEndHour: campaign.sendEndHour,
          weekdaysOnly: campaign.weekdaysOnly,
        }}
        sandboxed={sandboxed}
        steps={(campaign.sequence?.steps ?? []).map((s) => ({ delayDays: s.delayDays, subject: s.subject, subjectB: s.subjectB ?? "", body: s.body, aiPersonalise: s.aiPersonalise }))}
        stats={stats as { messages: Record<string, number>; events: Record<string, number> }}
        stepStats={stepStats}
        events={events.map((e) => ({ id: e.id, type: e.type, to: e.message.toEmail, at: e.createdAt.toISOString(), payload: e.payload as Record<string, unknown> }))}
      />
    </div>
  );
}
