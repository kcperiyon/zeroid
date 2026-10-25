import type { Prisma } from "@/generated/prisma/client";
import { recordLeadEvent } from "@/lib/lead-events";

type Tx = Prisma.TransactionClient;

/**
 * Turns one prospect into a lead (idempotent: an already-imported prospect is returned as-is).
 * Shared by the single "Import as lead" button and the bulk import so they can never diverge.
 */
export async function importProspectAsLead(tx: Tx, businessId: string, prospectId: string) {
  const prospect = await tx.prospect.findFirst({ where: { id: prospectId, businessId } });
  if (!prospect) return null;
  if (prospect.status !== "new") return prospect;

  let source = await tx.leadSource.findFirst({ where: { businessId, channel: prospect.channel } });
  if (!source) {
    source = await tx.leadSource.create({ data: { businessId, channel: prospect.channel, name: "Prospecting" } });
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
  await recordLeadEvent(tx, { businessId, leadId: lead.id, type: "lead_created", payload: { source: "prospecting", channel: prospect.channel } });
  return tx.prospect.update({ where: { id: prospectId }, data: { status: "imported", leadId: lead.id } });
}
