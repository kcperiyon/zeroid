import { NextResponse } from "next/server";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";

/** Copies a campaign (settings + sequence) as a fresh draft, so a good sequence can be reused. */
export async function POST(_request: Request, context: { params: Promise<{ id: string; campaignId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  const copy = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const src = await tx.campaign.findFirst({
      where: { id: campaignId, businessId: auth.businessId },
      include: { sequence: { include: { steps: { orderBy: { position: "asc" } } } } },
    });
    if (!src) return null;
    const campaign = await tx.campaign.create({
      data: {
        businessId: auth.businessId,
        organizationId: auth.user.organizationId,
        name: `${src.name} (copy)`.slice(0, 120),
        objective: src.objective,
        segmentId: src.segmentId,
        identityId: src.identityId,
        timezone: src.timezone,
        sendStartHour: src.sendStartHour,
        sendEndHour: src.sendEndHour,
        weekdaysOnly: src.weekdaysOnly,
      },
    });
    const sequence = await tx.sequence.create({ data: { businessId: auth.businessId, campaignId: campaign.id, name: `${campaign.name} sequence` } });
    if (src.sequence?.steps.length) {
      await tx.sequenceStep.createMany({
        data: src.sequence.steps.map((s) => ({
          businessId: auth.businessId, sequenceId: sequence.id, position: s.position, delayDays: s.delayDays,
          subject: s.subject, subjectB: s.subjectB, body: s.body, aiPersonalise: s.aiPersonalise,
        })),
      });
    }
    return campaign;
  });
  if (!copy) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  return NextResponse.json({ campaign: copy }, { status: 201 });
}
