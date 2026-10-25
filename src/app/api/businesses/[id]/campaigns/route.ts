import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { isValidTimezone } from "@/lib/email-campaigns/schedule";
import { DEFAULT_STEPS } from "@/lib/email-campaigns/defaults";
import { campaignStats } from "@/lib/email-campaigns/engine";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().max(500).optional(),
  segmentId: z.string().min(1),
  identityId: z.string().min(1),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone.").default("UTC"),
  sendStartHour: z.number().int().min(0).max(23).default(9),
  sendEndHour: z.number().int().min(1).max(24).default(17),
  weekdaysOnly: z.boolean().default(true),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const campaigns = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const rows = await tx.campaign.findMany({
      where: { businessId: auth.businessId },
      include: { segment: { select: { name: true } }, identity: { select: { name: true, provider: true } } },
      orderBy: { createdAt: "desc" },
    });
    const out = [];
    for (const c of rows) out.push({ ...c, stats: await campaignStats(tx, c.id) });
    return out;
  });
  return NextResponse.json({ campaigns });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign." }, { status: 400 });
  const d = parsed.data;
  if (d.sendEndHour <= d.sendStartHour) return NextResponse.json({ error: "The sending window must end after it starts." }, { status: 400 });

  const created = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const segment = await tx.segment.findFirst({ where: { id: d.segmentId, businessId: auth.businessId } });
    const identity = await tx.sendingIdentity.findFirst({ where: { id: d.identityId, businessId: auth.businessId } });
    if (!segment || !identity) return null;
    const campaign = await tx.campaign.create({
      data: {
        businessId: auth.businessId,
        organizationId: auth.user.organizationId,
        name: d.name,
        objective: d.objective,
        segmentId: d.segmentId,
        identityId: d.identityId,
        timezone: d.timezone,
        sendStartHour: d.sendStartHour,
        sendEndHour: d.sendEndHour,
        weekdaysOnly: d.weekdaysOnly,
      },
    });
    const sequence = await tx.sequence.create({ data: { businessId: auth.businessId, campaignId: campaign.id, name: `${d.name} sequence` } });
    await tx.sequenceStep.createMany({
      data: DEFAULT_STEPS.map((s) => ({ businessId: auth.businessId, sequenceId: sequence.id, position: s.position, delayDays: s.delayDays, subject: s.subject, body: s.body })),
    });
    return campaign;
  });
  if (!created) return NextResponse.json({ error: "Pick a segment and a sending identity from this business." }, { status: 400 });
  return NextResponse.json({ campaign: created }, { status: 201 });
}
