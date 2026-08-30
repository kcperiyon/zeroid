import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { calculateLeadScore, DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "@/lib/scoring";
import { recordLeadEvent } from "@/lib/lead-events";

const factor = z.number().int().min(0).max(100).nullable().optional();

const UpdateLeadSchema = z.object({
  stage: z
    .enum([
      "new", "contacted", "engaged", "qualified", "hot", "appointment",
      "proposal", "negotiation", "won", "lost", "nurture",
    ])
    .optional(),
  icpScore: factor,
  problemSeverity: factor,
  purchaseIntent: factor,
  budgetFit: factor,
  urgency: factor,
  engagement: factor,
  decisionAuthority: factor,
});

export async function GET(_request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const lead = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.lead.findFirst({
      where: { id: leadId, businessId },
      include: { events: { orderBy: { createdAt: "desc" } } },
    })
  );
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  return NextResponse.json({ lead });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = UpdateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid update." },
      { status: 400 }
    );
  }

  const lead = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const existing = await tx.lead.findFirst({ where: { id: leadId, businessId } });
    if (!existing) return null;

    const scoringConfig = await tx.scoringConfig.findUnique({ where: { businessId } });
    const weights = (scoringConfig?.weights as unknown as ScoringWeights) ?? DEFAULT_SCORING_WEIGHTS;

    const factors = {
      icpScore: parsed.data.icpScore !== undefined ? parsed.data.icpScore : existing.icpScore,
      problemSeverity: parsed.data.problemSeverity !== undefined ? parsed.data.problemSeverity : existing.problemSeverity,
      purchaseIntent: parsed.data.purchaseIntent !== undefined ? parsed.data.purchaseIntent : existing.purchaseIntent,
      budgetFit: parsed.data.budgetFit !== undefined ? parsed.data.budgetFit : existing.budgetFit,
      urgency: parsed.data.urgency !== undefined ? parsed.data.urgency : existing.urgency,
      engagement: parsed.data.engagement !== undefined ? parsed.data.engagement : existing.engagement,
      decisionAuthority: parsed.data.decisionAuthority !== undefined ? parsed.data.decisionAuthority : existing.decisionAuthority,
    };
    const leadScore = calculateLeadScore(factors, weights);

    const updated = await tx.lead.update({
      where: { id: leadId },
      data: { ...factors, stage: parsed.data.stage ?? existing.stage, leadScore },
    });

    if (parsed.data.stage && parsed.data.stage !== existing.stage) {
      await recordLeadEvent(tx, {
        businessId,
        leadId,
        type: "stage_changed",
        payload: { from: existing.stage, to: parsed.data.stage },
      });

      // Human handoff (build-spec §11 item 12 / vision doc §27): a lead
      // reaching "hot" needs a person to act on it. No AI conversation
      // exists yet to trigger this automatically from a real qualification
      // signal — a manual/future-AI stage change to "hot" is the trigger
      // for now, but the mechanism (a Task) is the same either way.
      if (parsed.data.stage === "hot") {
        await tx.task.create({
          data: {
            businessId,
            leadId,
            title: `Follow up: ${existing.name || existing.email || existing.phone || "lead"} marked HOT`,
            note: existing.leadScore != null ? `Lead score: ${existing.leadScore}` : undefined,
          },
        });
        await recordLeadEvent(tx, { businessId, leadId, type: "handoff_created" });
      }
    }
    if (leadScore !== existing.leadScore) {
      await recordLeadEvent(tx, {
        businessId,
        leadId,
        type: "score_updated",
        payload: { from: existing.leadScore, to: leadScore },
      });
    }

    return updated;
  });

  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  return NextResponse.json({ lead });
}
