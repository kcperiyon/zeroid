import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { deleteSource } from "@/lib/knowledge/client";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; sourceId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to remove trained knowledge." }, { status: 403 });
  }

  const { id: businessId, sourceId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const source = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.knowledgeSource.findFirst({ where: { id: sourceId, businessId } })
  );
  if (!source) return NextResponse.json({ error: "Knowledge source not found." }, { status: 404 });

  try {
    await deleteSource(sourceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete from the knowledge service.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.knowledgeSource.delete({ where: { id: sourceId } })
  );
  return NextResponse.json({ ok: true });
}
