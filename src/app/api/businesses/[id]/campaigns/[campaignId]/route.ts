import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { isValidTimezone } from "@/lib/email-campaigns/schedule";
import { campaignStats } from "@/lib/email-campaigns/engine";

type Ctx = { params: Promise<{ id: string; campaignId: string }> };

const StepSchema = z.object({
  delayDays: z.number().int().min(0).max(60),
  subject: z.string().trim().min(1).max(200),
  // Optional alternate subject line: leads are split 50/50 between the two (A/B test).
  subjectB: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  body: z.string().trim().min(1).max(8000),
  aiPersonalise: z.boolean().default(false),
});

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  objective: z.string().trim().max(500).nullable().optional(),
  segmentId: z.string().min(1).optional(),
  identityId: z.string().min(1).optional(),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone.").optional(),
  sendStartHour: z.number().int().min(0).max(23).optional(),
  sendEndHour: z.number().int().min(1).max(24).optional(),
  weekdaysOnly: z.boolean().optional(),
  steps: z.array(StepSchema).min(1).max(6).optional(),
});

export async function GET(_request: Request, context: Ctx) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  const data = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, businessId: auth.businessId },
      include: {
        segment: { select: { id: true, name: true } },
        identity: { select: { id: true, name: true, provider: true, sandboxOnly: true, fromEmail: true } },
        sequence: { include: { steps: { orderBy: { position: "asc" } } } },
      },
    });
    if (!campaign) return null;
    const stats = await campaignStats(tx, campaignId);
    const events = await tx.emailEvent.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { message: { select: { toEmail: true } } },
    });
    return { campaign, stats, events };
  });
  if (!data) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid changes." }, { status: 400 });
  const { steps, ...fields } = parsed.data;

  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const campaign = await tx.campaign.findFirst({ where: { id: campaignId, businessId: auth.businessId }, include: { sequence: true } });
    if (!campaign) return { error: "Campaign not found.", status: 404 };
    if (campaign.status === "active" || campaign.status === "completed") {
      return { error: "Pause the campaign before editing it.", status: 409 };
    }
    if (steps && campaign.status !== "draft") {
      return { error: "The email steps can only be edited before the campaign is launched.", status: 409 };
    }
    const start = fields.sendStartHour ?? campaign.sendStartHour;
    const end = fields.sendEndHour ?? campaign.sendEndHour;
    if (end <= start) return { error: "The sending window must end after it starts.", status: 400 };
    if (fields.segmentId && !(await tx.segment.findFirst({ where: { id: fields.segmentId, businessId: auth.businessId } }))) return { error: "Segment not found.", status: 400 };
    if (fields.identityId && !(await tx.sendingIdentity.findFirst({ where: { id: fields.identityId, businessId: auth.businessId } }))) return { error: "Sending identity not found.", status: 400 };

    await tx.campaign.update({ where: { id: campaignId }, data: { ...fields, objective: fields.objective === undefined ? undefined : fields.objective } });
    if (steps && campaign.sequence) {
      await tx.sequenceStep.deleteMany({ where: { sequenceId: campaign.sequence.id } });
      await tx.sequenceStep.createMany({
        data: steps.map((s, i) => ({ businessId: auth.businessId, sequenceId: campaign.sequence!.id, position: i + 1, delayDays: i === 0 ? 0 : s.delayDays, subject: s.subject, subjectB: s.subjectB ?? null, body: s.body, aiPersonalise: s.aiPersonalise })),
      });
    }
    return { ok: true as const };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** Deletes a campaign that is not currently running, together with its sequence, messages and events. */
export async function DELETE(_request: Request, context: Ctx) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const campaign = await tx.campaign.findFirst({ where: { id: campaignId, businessId: auth.businessId } });
    if (!campaign) return { status: 404, error: "Campaign not found." };
    if (campaign.status === "active") return { status: 409, error: "Pause the campaign before deleting it." };
    await tx.emailEvent.deleteMany({ where: { campaignId } });
    await tx.campaignMessage.deleteMany({ where: { campaignId } });
    const seq = await tx.sequence.findFirst({ where: { campaignId } });
    if (seq) {
      await tx.sequenceStep.deleteMany({ where: { sequenceId: seq.id } });
      await tx.sequence.delete({ where: { id: seq.id } });
    }
    await tx.campaign.delete({ where: { id: campaignId } });
    return { status: 200 };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
