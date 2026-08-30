import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { recordLeadEvent } from "@/lib/lead-events";

const CreateAppointmentSchema = z.object({
  startAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = CreateAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid appointment." }, { status: 400 });
  }

  const appointment = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) return null;

    const created = await tx.appointment.create({
      data: { businessId, leadId, startAt: new Date(parsed.data.startAt), notes: parsed.data.notes },
    });
    await recordLeadEvent(tx, {
      businessId,
      leadId,
      type: "appointment_booked",
      payload: { startAt: parsed.data.startAt },
    });
    return created;
  });

  if (!appointment) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  return NextResponse.json({ appointment }, { status: 201 });
}
