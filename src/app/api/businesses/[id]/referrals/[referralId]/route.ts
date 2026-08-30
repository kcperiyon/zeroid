import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const UpdateSchema = z.object({ status: z.enum(["pending", "converted", "declined"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string; referralId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, referralId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid update." }, { status: 400 });

  const referral = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const existing = await tx.referral.findFirst({ where: { id: referralId, businessId } });
    if (!existing) return null;
    return tx.referral.update({ where: { id: referralId }, data: { status: parsed.data.status } });
  });

  if (!referral) return NextResponse.json({ error: "Referral not found." }, { status: 404 });
  return NextResponse.json({ referral });
}
