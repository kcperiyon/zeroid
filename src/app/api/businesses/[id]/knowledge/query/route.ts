import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg } from "@/lib/tenant-db";
import { retrieve } from "@/lib/knowledge/client";

const QuerySchema = z.object({ query: z.string().min(1).max(500) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = QuerySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query." }, { status: 400 });
  }

  try {
    const results = await retrieve({ query: parsed.data.query, businessId });
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the knowledge service.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
