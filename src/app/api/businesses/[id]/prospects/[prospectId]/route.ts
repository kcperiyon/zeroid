import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { recordLeadEvent } from "@/lib/lead-events";

const ActionSchema = z.object({ action: z.enum(["import", "dismiss"]) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; prospectId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to act on prospects." }, { status: 403 });
  }

  const { id: businessId, prospectId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const result = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const prospect = await tx.prospect.findFirst({ where: { id: prospectId, businessId } });
    if (!prospect) return null;
    if (prospect.status !== "new") return prospect;

    if (parsed.data.action === "dismiss") {
      return tx.prospect.update({ where: { id: prospectId }, data: { status: "dismissed" } });
    }

    let source = await tx.leadSource.findFirst({ where: { businessId, channel: prospect.channel } });
    if (!source) {
      source = await tx.leadSource.create({
        data: { businessId, channel: prospect.channel, name: "Prospecting" },
      });
    }

    const lead = await tx.lead.create({
      data: {
        businessId,
        sourceId: source.id,
        name: prospect.name,
        email: prospect.email,
        phone: prospect.phone,
        company: prospect.name,
        contact: { address: prospect.address, website: prospect.website, category: prospect.category },
      },
    });
    await recordLeadEvent(tx, {
      businessId,
      leadId: lead.id,
      type: "lead_created",
      payload: { source: "prospecting", channel: prospect.channel },
    });

    return tx.prospect.update({ where: { id: prospectId }, data: { status: "imported", leadId: lead.id } });
  });

  if (!result) return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  return NextResponse.json({ prospect: result });
}
