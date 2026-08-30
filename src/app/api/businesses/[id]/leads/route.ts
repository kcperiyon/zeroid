import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { calculateLeadScore, DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "@/lib/scoring";
import { recordLeadEvent } from "@/lib/lead-events";

const factor = z.number().int().min(0).max(100).optional();

const CreateLeadSchema = z.object({
  name: z.string().max(160).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  company: z.string().max(160).optional(),
  icpScore: factor,
  problemSeverity: factor,
  purchaseIntent: factor,
  budgetFit: factor,
  urgency: factor,
  engagement: factor,
  decisionAuthority: factor,
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const leads = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.lead.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } })
  );
  return NextResponse.json({ leads });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid lead details." },
      { status: 400 }
    );
  }
  if (!parsed.data.name && !parsed.data.email && !parsed.data.phone) {
    return NextResponse.json({ error: "Provide at least a name, email, or phone." }, { status: 400 });
  }

  const lead = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const scoringConfig = await tx.scoringConfig.findUnique({ where: { businessId } });
    const weights = (scoringConfig?.weights as unknown as ScoringWeights) ?? DEFAULT_SCORING_WEIGHTS;

    const leadScore = calculateLeadScore(
      {
        icpScore: parsed.data.icpScore ?? null,
        problemSeverity: parsed.data.problemSeverity ?? null,
        purchaseIntent: parsed.data.purchaseIntent ?? null,
        budgetFit: parsed.data.budgetFit ?? null,
        urgency: parsed.data.urgency ?? null,
        engagement: parsed.data.engagement ?? null,
        decisionAuthority: parsed.data.decisionAuthority ?? null,
      },
      weights
    );

    const created = await tx.lead.create({
      data: {
        businessId,
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        company: parsed.data.company,
        icpScore: parsed.data.icpScore,
        problemSeverity: parsed.data.problemSeverity,
        purchaseIntent: parsed.data.purchaseIntent,
        budgetFit: parsed.data.budgetFit,
        urgency: parsed.data.urgency,
        engagement: parsed.data.engagement,
        decisionAuthority: parsed.data.decisionAuthority,
        leadScore,
      },
    });

    await recordLeadEvent(tx, {
      businessId,
      leadId: created.id,
      type: "lead_created",
      payload: { source: "manual", leadScore },
    });

    return created;
  });

  return NextResponse.json({ lead }, { status: 201 });
}
