import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { fetchNewsTriggers } from "@/lib/prospecting/news-triggers";
import { generate, buildPrompt } from "@/lib/ai";
import { parseJsonResponse } from "@/lib/ai/json";

/**
 * Prospecting via trigger events (build-spec §12 Phase 2 prospecting):
 * search Google News RSS (free, no key) for a query, then ONE AI call
 * extracts which headlines actually describe a real business (funding,
 * expansion, launch, hiring) worth prospecting, filtering out unrelated
 * news -- deliberately one call for the whole batch, not one per headline,
 * to keep this cheap regardless of how many articles come back.
 */
const SearchSchema = z.object({ query: z.string().min(1).max(200) });

const ExtractionSchema = z.array(
  z.object({
    companyName: z.string(),
    trigger: z.string(),
    itemIndex: z.number().int(),
  })
);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to search for prospects." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = SearchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid search." }, { status: 400 });
  }

  let items;
  try {
    items = await fetchNewsTriggers(parsed.data.query);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Google News.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (items.length === 0) {
    return NextResponse.json({ prospects: [] }, { status: 201 });
  }

  const prompt = buildPrompt([
    {
      label: "Task",
      content:
        "Below is a numbered list of real news headlines. Identify ONLY the ones that describe a " +
        "specific real business experiencing a buying-trigger event: raised funding, opened a new " +
        "location, launched a new product/service, or is actively hiring for a role that suggests " +
        "they're scaling. Ignore politics, general industry commentary, or anything not about one " +
        "specific named business. Respond with ONLY a JSON array (no markdown fence, no other text), " +
        'each item shaped exactly like {"companyName":"...","trigger":"one sentence","itemIndex":N} ' +
        "where itemIndex is the headline's number below. Return an empty array [] if none qualify.",
    },
    {
      label: "Headlines",
      content: items.map((item, i) => `${i}. ${item.title}`).join("\n"),
    },
  ]);

  let extracted: z.infer<typeof ExtractionSchema>;
  try {
    const result = await generate(user.organizationId, businessId, "research", {
      system: "You extract structured business-trigger data from news headlines. You never invent a company that isn't named in the headline.",
      prompt,
      maxTokens: 1000,
    });
    const json = parseJsonResponse<unknown>(result.text);
    extracted = ExtractionSchema.parse(json);
  } catch {
    return NextResponse.json(
      { error: "The AI didn't return a usable extraction. Try a more specific search." },
      { status: 502 }
    );
  }

  const prospects = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const rows = [];
    for (const entry of extracted) {
      const item = items[entry.itemIndex];
      if (!item) continue;
      const externalId = item.link;
      const row = await tx.prospect.upsert({
        where: { businessId_channel_externalId: { businessId, channel: "news", externalId } },
        update: { name: entry.companyName, category: entry.trigger, sourceUrl: item.link },
        create: {
          businessId,
          channel: "news",
          externalId,
          name: entry.companyName,
          category: entry.trigger,
          sourceUrl: item.link,
        },
      });
      rows.push(row);
    }
    return rows;
  });

  return NextResponse.json({ prospects }, { status: 201 });
}
