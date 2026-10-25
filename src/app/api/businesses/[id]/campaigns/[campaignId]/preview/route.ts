import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { buildMessage, firstNameOf } from "@/lib/email-campaigns/template";
import { parseSegmentFilter, segmentWhere } from "@/lib/email-campaigns/segments";

const Schema = z.object({ step: z.number().int().min(1).max(6).default(1) });

/** Renders one step exactly as it would be sent, for a real lead from the segment (or a sample). */
export async function POST(request: Request, context: { params: Promise<{ id: string; campaignId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid step." }, { status: 400 });

  const data = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, businessId: auth.businessId },
      include: { segment: true, identity: true, sequence: { include: { steps: { orderBy: { position: "asc" } } } } },
    });
    if (!campaign) return null;
    const step = campaign.sequence?.steps.find((s) => s.position === parsed.data.step);
    const lead = await tx.lead.findFirst({ where: segmentWhere(auth.businessId, parseSegmentFilter(campaign.segment.filter)), orderBy: { createdAt: "asc" } });
    return { campaign, step, lead };
  });
  if (!data?.step) return NextResponse.json({ error: "Step not found." }, { status: 404 });
  const { campaign, step, lead } = data;

  const base = (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  const built = buildMessage({
    subjectTemplate: step.subject,
    bodyTemplate: step.body,
    vars: {
      firstName: lead ? firstNameOf(lead.name) : "Alex",
      name: lead?.name ?? "Alex Morgan",
      company: lead?.company ?? "Example Ltd",
      senderName: campaign.identity.fromName,
      email: lead?.email ?? "alex@example.com",
    },
    token: "PREVIEWTOKEN000000000",
    baseUrl: base,
    fromName: campaign.identity.fromName,
    fromEmail: campaign.identity.fromEmail,
    replyToEmail: campaign.identity.replyToEmail,
    physicalAddress: campaign.identity.physicalAddress,
  });
  return NextResponse.json({
    subject: built.subject,
    html: built.html,
    text: built.text,
    from: `${campaign.identity.fromName} <${campaign.identity.fromEmail}>`,
    sampleLead: lead ? { name: lead.name, company: lead.company } : null,
  });
}
