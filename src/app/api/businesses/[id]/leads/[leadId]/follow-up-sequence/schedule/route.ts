import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { recordLeadEvent } from "@/lib/lead-events";

/**
 * Turns a reviewed sequence into dated Tasks -- a human sends each one when
 * it comes due. No scheduler and no auto-send (Autopilot is held off), so a
 * due Task in the Handoff list is the reminder.
 */
const ScheduleSchema = z.object({
  situation: z.string().max(40),
  steps: z
    .array(z.object({ dayOffset: z.number().int().min(0).max(120), message: z.string().min(1).max(2000) }))
    .min(1)
    .max(8),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id: businessId, leadId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const parsed = ScheduleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sequence." }, { status: 400 });
  const { situation, steps } = parsed.data;

  const created = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, businessId } });
    if (!lead) return null;
    const who = lead.name ?? lead.company ?? "lead";
    const now = Date.now();
    for (const [i, step] of steps.entries()) {
      await tx.task.create({
        data: {
          businessId,
          leadId,
          title: `Follow up with ${who} (step ${i + 1}/${steps.length})`,
          note: step.message,
          dueAt: new Date(now + step.dayOffset * 86_400_000),
          assignedToUserId: lead.assignedToUserId ?? undefined,
        },
      });
    }
    await recordLeadEvent(tx, {
      businessId,
      leadId,
      type: "follow_up_sequence_scheduled",
      payload: { situation, steps: steps.length },
    });
    return steps.length;
  });

  if (created === null) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  return NextResponse.json({ scheduled: created }, { status: 201 });
}
