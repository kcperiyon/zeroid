import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { generate, buildBusinessSystemPrompt, buildPrompt } from "@/lib/ai";

const PURPOSES = [
  "awareness", "problem_identification", "education", "authority",
  "trust", "objection_handling", "lead_capture", "conversion",
] as const;

const CreateContentSchema = z.object({
  purpose: z.enum(PURPOSES),
  channel: z.string().min(1).max(60),
  extraInstructions: z.string().max(1000).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const contentItems = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.contentItem.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } })
  );
  return NextResponse.json({ contentItems });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateContentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const { products, instructions, icpProfiles } = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const [products, instructions, icpProfiles] = await Promise.all([
      tx.product.findMany({ where: { businessId } }),
      tx.aiInstruction.findMany({ where: { businessId, status: "active" } }),
      tx.icpProfile.findMany({ where: { businessId, isActive: true } }),
    ]);
    return { products, instructions, icpProfiles };
  });

  const system = buildBusinessSystemPrompt({ business, products, instructions });
  const prompt = buildPrompt([
    {
      label: "Task",
      content:
        `Write a short piece of ${parsed.data.channel} content whose purpose is "${parsed.data.purpose.replace(/_/g, " ")}". ` +
        "No income guarantees, no fabricated urgency, no discounts unless already listed above.",
    },
    {
      label: "Ideal customer",
      content: icpProfiles.map((p) => `- ${p.name}: ${JSON.stringify(p.attributes)}`).join("\n"),
    },
    { label: "Extra instructions", content: parsed.data.extraInstructions ?? "" },
  ]);

  let text: string;
  try {
    const result = await generate(user.organizationId, businessId, "content_generation", { system, prompt, maxTokens: 400 });
    text = result.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI call failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const contentItem = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.contentItem.create({
      data: {
        businessId,
        purpose: parsed.data.purpose,
        channel: parsed.data.channel,
        prompt: parsed.data.extraInstructions ?? "",
        content: text,
      },
    })
  );

  return NextResponse.json({ contentItem }, { status: 201 });
}
