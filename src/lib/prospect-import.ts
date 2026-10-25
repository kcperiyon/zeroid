import type { Prisma } from "@/generated/prisma/client";
import { recordLeadEvent } from "@/lib/lead-events";
import { getSendThreshold } from "@/lib/discovery/store";
import { pickSendable } from "@/lib/discovery/emails";

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
  // Discovered prospects carry scored addresses: only one at or above the business threshold is
  // copied onto the lead, so a guess can never end up in a campaign. Prospects that were never
  // enriched (manual search results) keep their single address as before.
  const scored = await tx.prospectEmail.findMany({ where: { prospectId }, orderBy: [{ confidence: "desc" }] });
  // A discovered prospect that has not been scored yet has no address we are allowed to trust.
  let email = prospect.discoveryJobId ? null : prospect.email;
  let emailConfidence: number | null = null;
  if (scored.length) {
    const threshold = await getSendThreshold(tx, businessId);
    const pick = pickSendable(scored, threshold);
    email = pick?.email ?? null;
    emailConfidence = pick?.confidence ?? null;
  }
  const signals = (prospect.signals ?? {}) as { people?: unknown; phones?: unknown; socials?: unknown; tech?: unknown; title?: unknown };
  const lead = await tx.lead.create({
    data: {
      businessId,
      sourceId: source.id,
      name: prospect.name,
      email,
      phone: prospect.phone,
      company: prospect.name,
      emailConfidence,
      researchNote: prospect.researchNote,
      contact: {
        address: prospect.address, website: prospect.website, category: prospect.category,
        ...(prospect.country ? { country: prospect.country } : {}),
        ...(prospect.domain ? { domain: prospect.domain } : {}),
        ...(signals.people ? { people: signals.people } : {}),
        ...(signals.socials ? { socials: signals.socials } : {}),
        ...(signals.tech ? { tech: signals.tech } : {}),
      } as Prisma.InputJsonValue,
    },
  });
  await recordLeadEvent(tx, { businessId, leadId: lead.id, type: "lead_created", payload: { source: "prospecting", channel: prospect.channel } });
  return tx.prospect.update({ where: { id: prospectId }, data: { status: "imported", leadId: lead.id } });
}
