import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { ingestText, ingestUrl } from "@/lib/knowledge/client";

const CreateKnowledgeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), title: z.string().min(1).max(160), text: z.string().min(1).max(20000) }),
  z.object({ type: z.literal("url"), title: z.string().min(1).max(160), url: z.string().url() }),
]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const sources = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.knowledgeSource.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } })
  );
  return NextResponse.json({ sources });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to train the AI." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateKnowledgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid knowledge source." },
      { status: 400 }
    );
  }

  const source = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.knowledgeSource.create({
      data: {
        businessId,
        type: parsed.data.type,
        title: parsed.data.title,
        status: "processing",
      },
    })
  );

  try {
    if (parsed.data.type === "text") {
      await ingestText({ sourceId: source.id, sourceName: parsed.data.title, text: parsed.data.text, businessId });
    } else {
      await ingestUrl({ sourceId: source.id, url: parsed.data.url, name: parsed.data.title, businessId });
    }
    const updated = await withBusinessScope(user.organizationId, businessId, (tx) =>
      tx.knowledgeSource.update({ where: { id: source.id }, data: { status: "ready" } })
    );
    return NextResponse.json({ source: updated }, { status: 201 });
  } catch (error) {
    await withBusinessScope(user.organizationId, businessId, (tx) =>
      tx.knowledgeSource.update({ where: { id: source.id }, data: { status: "failed" } })
    );
    const message = error instanceof Error ? error.message : "Ingestion failed.";
    return NextResponse.json({ error: message, source: { ...source, status: "failed" } }, { status: 502 });
  }
}
