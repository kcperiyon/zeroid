import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { ingestFile } from "@/lib/knowledge/client";

// The knowledge service's document processor handles pdf/docx and falls back
// to plain text. Its nginx path (wa.lagosbusinessgroup.com/platform/knowledge/)
// has no client_max_body_size set, so nginx's 1 MB default caps real uploads
// until that's raised there -- this app-side limit is deliberately looser
// than that so the nginx cap surfaces as an honest error, not a silent one.
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["pdf", "docx", "txt", "md"];

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to train the AI." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED.includes(ext)) {
    return NextResponse.json({ error: `Unsupported file type. Use: ${ALLOWED.join(", ")}.` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (10 MB max)." }, { status: 400 });
  }

  const title = String(form?.get("title") ?? "").trim() || file.name;

  const source = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.knowledgeSource.create({
      data: { businessId, type: ext === "pdf" ? "pdf" : "doc", title, status: "processing" },
    })
  );

  try {
    await ingestFile({ sourceId: source.id, name: title, businessId, file });
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
