import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { recordLeadEvent } from "@/lib/lead-events";

const CreateReferralSchema = z.object({
  referredName: z.string().min(1).max(160),
  referredContact: z.string().max(200).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateReferralSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid referral." }, { status: 400 });
  }

  const referral = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) return null;

    const created = await tx.referral.create({
      data: { businessId, referrerLeadId: leadId, referredName: parsed.data.referredName, referredContact: parsed.data.referredContact },
    });
    await recordLeadEvent(tx, { businessId, leadId, type: "referral_logged", payload: { referredName: parsed.data.referredName } });
    return created;
  });

  if (!referral) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  return NextResponse.json({ referral }, { status: 201 });
}
