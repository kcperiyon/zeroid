import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { generate, buildBusinessSystemPrompt, buildPrompt } from "@/lib/ai";
import { recordLeadEvent } from "@/lib/lead-events";
import { FOLLOW_UP_SITUATIONS, situationGuidance } from "@/lib/follow-up-situations";

/**
 * Drafts a follow-up message for a rep to review and send — see build-spec
 * §13/§28: "Basic AI follow-up." AI Suggest tier only (build-spec §37) — it
 * never sends anything itself. There's no WhatsApp send capability yet
 * (waiting on ../platform-services) and no scheduler, so this is scoped to
 * exactly what's honestly buildable right now: draft-on-demand, human sends.
 * Optional `situation` tailors the guidance per build-spec §28's list.
 */
const RequestSchema = z.object({
  situation: z.enum(FOLLOW_UP_SITUATIONS.map((s) => s.value) as [string, ...string[]]).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsedBody = RequestSchema.safeParse(body);
  const situation = parsedBody.success ? parsedBody.data.situation : undefined;

  const { lead, products, instructions } = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const [lead, products, instructions] = await Promise.all([
      tx.lead.findFirst({ where: { id: leadId, businessId } }),
      tx.product.findMany({ where: { businessId } }),
      tx.aiInstruction.findMany({ where: { businessId, status: "active" } }),
    ]);
    return { lead, products, instructions };
  });
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const system = buildBusinessSystemPrompt({ business, products, instructions });
  const prompt = buildPrompt([
    {
      label: "Task",
      content:
        "Draft a short, non-pushy WhatsApp/email follow-up message to this lead. " +
        "One or two sentences. No income guarantees, no discounts, no fabricated urgency. " +
        situationGuidance(situation),
    },
    {
      label: "Lead",
      content: [
        lead.name && `Name: ${lead.name}`,
        lead.company && `Company: ${lead.company}`,
        `Stage: ${lead.stage}`,
        lead.leadScore != null && `Score: ${lead.leadScore}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ]);

  let draft: string;
  try {
    const result = await generate(user.organizationId, businessId, "follow_up_draft", { system, prompt, maxTokens: 200 });
    draft = result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI call failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await withBusinessScope(user.organizationId, businessId, (tx) =>
    recordLeadEvent(tx, { businessId, leadId, type: "follow_up_drafted", payload: { draft, situation } })
  );

  return NextResponse.json({ draft });
}
