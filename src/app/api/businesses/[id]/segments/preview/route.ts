import { NextResponse } from "next/server";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { SegmentFilterSchema, segmentWhere } from "@/lib/email-campaigns/segments";

/** Live count + a small sample for a filter, so the builder shows who it would email before saving. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const parsed = SegmentFilterSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filter." }, { status: 400 });

  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const where = segmentWhere(auth.businessId, parsed.data);
    const count = await tx.lead.count({ where });
    const sample = await tx.lead.findMany({ where, select: { name: true, company: true, email: true }, take: 5, orderBy: { createdAt: "desc" } });
    return { count, sample };
  });
  return NextResponse.json(result);
}
