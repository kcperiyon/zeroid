import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { SegmentFilterSchema } from "@/lib/email-campaigns/segments";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const UpdateSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), filter: SegmentFilterSchema.optional() });

/** A segment used by a RUNNING campaign cannot change under it; otherwise edit freely. */
export async function PATCH(request: Request, context: Ctx) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { segmentId } = await context.params;
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid segment." }, { status: 400 });

  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const seg = await tx.segment.findFirst({ where: { id: segmentId, businessId: auth.businessId } });
    if (!seg) return { status: 404, error: "Segment not found." };
    if (parsed.data.filter && (await tx.campaign.count({ where: { segmentId, status: { in: ["active", "paused"] } } })) > 0) {
      return { status: 409, error: "A running or paused campaign uses this segment, so its filter cannot change. Duplicate the segment instead." };
    }
    await tx.segment.update({ where: { id: segmentId }, data: { ...(parsed.data.name ? { name: parsed.data.name } : {}), ...(parsed.data.filter ? { filter: parsed.data.filter } : {}) } });
    return { status: 200 };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Ctx) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { segmentId } = await context.params;
  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    if ((await tx.campaign.count({ where: { segmentId } })) > 0) return { status: 409, error: "A campaign uses this segment. Delete that campaign first." };
    const gone = await tx.segment.deleteMany({ where: { id: segmentId, businessId: auth.businessId } });
    return gone.count ? { status: 200 } : { status: 404, error: "Segment not found." };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
