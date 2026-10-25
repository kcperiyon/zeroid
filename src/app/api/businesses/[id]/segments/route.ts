import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { SegmentFilterSchema, segmentWhere } from "@/lib/email-campaigns/segments";

const CreateSchema = z.object({ name: z.string().trim().min(1).max(80), filter: SegmentFilterSchema });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const rows = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const segments = await tx.segment.findMany({ where: { businessId: auth.businessId }, orderBy: { createdAt: "asc" } });
    const out = [];
    for (const s of segments) {
      out.push({ ...s, size: await tx.lead.count({ where: segmentWhere(auth.businessId, SegmentFilterSchema.catch({}).parse(s.filter)) }) });
    }
    return out;
  });
  return NextResponse.json({ segments: rows });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid segment." }, { status: 400 });
  const segment = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.segment.create({ data: { businessId: auth.businessId, name: parsed.data.name, filter: parsed.data.filter } })
  );
  return NextResponse.json({ segment }, { status: 201 });
}
