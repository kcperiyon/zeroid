import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { generate, buildBusinessSystemPrompt, buildPrompt } from "@/lib/ai";
import { parseJsonResponse } from "@/lib/ai/json";
import { FOLLOW_UP_SITUATIONS, situationGuidance } from "@/lib/follow-up-situations";
import { sequenceFor } from "@/lib/follow-up-sequences";

/**
 * Drafts a whole multi-step follow-up sequence in ONE AI call (cheaper than
 * one call per step). AI Suggest tier: nothing is saved or sent here -- the
 * rep reviews/edits the steps and schedules them via ./schedule.
 */
const RequestSchema = z.object({
  situation: z.enum(FOLLOW_UP_SITUATIONS.map((s) => s.value) as [string, ...string[]]),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const parsedBody = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: "Pick a situation." }, { status: 400 });
  const { situation } = parsedBody.data;
  const steps = sequenceFor(situation);

  const { lead, products, instructions } = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const [lead, products, instructions] = await Promise.all([
      tx.lead.findFirst({ where: { id: leadId, businessId } }),
      tx.product.findMany({ where: { businessId } }),
      tx.aiInstruction.findMany({ where: { businessId, status: "active" } }),
    ]);
    return { lead, products, instructions };
  });
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const prompt = buildPrompt([
    {
      label: "Task",
      content:
        `Write a ${steps.length}-step follow-up sequence of short, non-pushy WhatsApp/email messages to this lead, ` +
        "one message per step below. One or two sentences each. No income guarantees, no discounts, no fabricated " +
        "urgency, and never invent facts about the business. " + situationGuidance(situation) +
        ` Respond with ONLY a JSON array of exactly ${steps.length} strings (the messages, in order), no markdown fence.`,
    },
    {
      label: "Steps",
      content: steps.map((s, i) => `${i + 1}. (day ${s.dayOffset}) ${s.intent}`).join("\n"),
    },
    {
      label: "Lead",
      content: [lead.name && `Name: ${lead.name}`, lead.company && `Company: ${lead.company}`, `Stage: ${lead.stage}`]
        .filter(Boolean)
        .join("\n"),
    },
  ]);

  try {
    const result = await generate(user.organizationId, businessId, "follow_up_draft", {
      system: buildBusinessSystemPrompt({ business, products, instructions }),
      prompt,
      maxTokens: 150 * steps.length + 100,
    });
    const messages = z.array(z.string()).length(steps.length).parse(parseJsonResponse<unknown>(result.text));
    return NextResponse.json({
      steps: steps.map((s, i) => ({ dayOffset: s.dayOffset, intent: s.intent, message: messages[i] })),
    });
  } catch (error) {
    console.error("follow-up-sequence failed:", error);
    return NextResponse.json({ error: "The AI didn't return a usable sequence. Try again." }, { status: 502 });
  }
}
