import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";

const UpdateSchema = z.object({ status: z.enum(["scheduled", "completed", "canceled", "no_show"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string; appointmentId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, appointmentId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid update." }, { status: 400 });

  const appointment = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const existing = await tx.appointment.findFirst({ where: { id: appointmentId, businessId } });
    if (!existing) return null;
    return tx.appointment.update({ where: { id: appointmentId }, data: { status: parsed.data.status } });
  });

  if (!appointment) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  return NextResponse.json({ appointment });
}
