import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { generate, buildBusinessSystemPrompt, buildPrompt } from "@/lib/ai";
import { parseJsonResponse } from "@/lib/ai/json";

/**
 * "AI Suggest" tier qualification (build-spec §37): given whatever a rep
 * knows about a lead so far, AI proposes the seven 0-100 factors from
 * build-spec §6/§25 with a short rationale. Nothing is saved here — the
 * lead's actual factors are only written when the rep reviews these numbers
 * in the lead editor and clicks "Save factors" themselves. This is the
 * honest middle ground between "AI qualification conversation over
 * WhatsApp" (still blocked on platform-services) and pure manual entry.
 */
const RequestSchema = z.object({ notes: z.string().min(1).max(4000) });

const FactorsSchema = z.object({
  icpScore: z.number().int().min(0).max(100),
  problemSeverity: z.number().int().min(0).max(100),
  purchaseIntent: z.number().int().min(0).max(100),
  budgetFit: z.number().int().min(0).max(100),
  urgency: z.number().int().min(0).max(100),
  engagement: z.number().int().min(0).max(100),
  decisionAuthority: z.number().int().min(0).max(100),
  rationale: z.string(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Describe what you know about this lead first." }, { status: 400 });
  }

  const { lead, products, instructions, icpProfiles } = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const [lead, products, instructions, icpProfiles] = await Promise.all([
      tx.lead.findFirst({ where: { id: leadId, businessId } }),
      tx.product.findMany({ where: { businessId } }),
      tx.aiInstruction.findMany({ where: { businessId, status: "active" } }),
      tx.icpProfile.findMany({ where: { businessId, isActive: true } }),
    ]);
    return { lead, products, instructions, icpProfiles };
  });
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const system = buildBusinessSystemPrompt({ business, products, instructions });
  const prompt = buildPrompt([
    {
      label: "Task",
      content:
        "Score this lead on the seven factors below, each 0-100 (0 = no evidence of this at all, " +
        "100 = extremely strong). Base scores only on what's actually stated in the notes — " +
        "if something isn't mentioned, score it low rather than assuming the best. Respond with " +
        "ONLY a JSON object (no markdown fence, no other text) shaped exactly like:\n" +
        `{"icpScore":0-100,"problemSeverity":0-100,"purchaseIntent":0-100,"budgetFit":0-100,` +
        `"urgency":0-100,"engagement":0-100,"decisionAuthority":0-100,"rationale":"one sentence"}`,
    },
    {
      label: "Ideal customer profile",
      content: icpProfiles.map((p) => `- ${p.name}: ${JSON.stringify(p.attributes)}`).join("\n"),
    },
    {
      label: "What the rep knows about this lead",
      content: [lead.name && `Name: ${lead.name}`, lead.company && `Company: ${lead.company}`, parsed.data.notes]
        .filter(Boolean)
        .join("\n"),
    },
  ]);

  let suggestion: z.infer<typeof FactorsSchema>;
  try {
    const result = await generate(user.organizationId, businessId, "lead_classification", {
      system,
      prompt,
      maxTokens: 300,
    });
    const json = parseJsonResponse<unknown>(result.text);
    suggestion = FactorsSchema.parse(json);
  } catch {
    return NextResponse.json(
      { error: "The AI didn't return a usable suggestion. Try again or enter factors manually." },
      { status: 502 }
    );
  }

  return NextResponse.json({ suggestion });
}
