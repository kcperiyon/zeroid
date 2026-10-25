import { Prisma } from "@/generated/prisma/client";
import type { Candidate } from "./osm";
import type { EnrichInput, EnrichResult } from "./enrich";
import { DEFAULT_SEND_THRESHOLD, pickSendable } from "./emails";
import { buildResearchNote } from "./note";
import { domainOf, isCompanySite, normalizeName, phoneKey } from "./normalize";

type Tx = Prisma.TransactionClient;

/** Business-level send threshold: settings.minEmailConfidence, clamped so it cannot be set to "send anything". */
export async function getSendThreshold(tx: Tx, businessId: string): Promise<number> {
  const b = await tx.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  const v = Number((b?.settings as { minEmailConfidence?: unknown } | null)?.minEmailConfidence);
  return Number.isFinite(v) ? Math.max(40, Math.min(95, Math.round(v))) : DEFAULT_SEND_THRESHOLD;
}

type Match = { id: string; how: "externalId" | "domain" | "phone" | "name" };

/** Finds the prospect this candidate already is, if any: same source id, same company site, same phone, or same name at the same spot. */
async function findExisting(tx: Tx, businessId: string, c: Candidate, domain: string | null): Promise<Match | null> {
  const byId = await tx.prospect.findFirst({ where: { businessId, channel: c.channel, externalId: c.externalId }, select: { id: true } });
  if (byId) return { id: byId.id, how: "externalId" };
  if (domain) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Prospect" WHERE "businessId" = ${businessId} AND lower("domain") = ${domain} LIMIT 1`;
    if (rows[0]) return { id: rows[0].id, how: "domain" };
  }
  const pk = phoneKey(c.phone);
  if (pk) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Prospect" WHERE "businessId" = ${businessId} AND phone IS NOT NULL
        AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = ${pk} LIMIT 1`;
    if (rows[0]) return { id: rows[0].id, how: "phone" };
  }
  if (c.lat != null && c.lon != null) {
    const near = await tx.prospect.findMany({
      where: { businessId, lat: { gte: c.lat - 0.003, lte: c.lat + 0.003 }, lon: { gte: c.lon - 0.003, lte: c.lon + 0.003 } },
      select: { id: true, name: true },
      take: 50,
    });
    const key = normalizeName(c.name);
    const hit = key && near.find((n) => normalizeName(n.name) === key);
    if (hit) return { id: hit.id, how: "name" };
  }
  return null;
}

/** Is this company already one of the business's leads (by address, phone or email domain)? */
async function existingLeadFor(tx: Tx, businessId: string, c: Candidate, domain: string | null): Promise<string | null> {
  if (c.email) {
    const l = await tx.lead.findFirst({ where: { businessId, email: { equals: c.email, mode: "insensitive" } }, select: { id: true } });
    if (l) return l.id;
  }
  if (domain) {
    const l = await tx.lead.findFirst({ where: { businessId, email: { endsWith: `@${domain}`, mode: "insensitive" } }, select: { id: true } });
    if (l) return l.id;
  }
  const pk = phoneKey(c.phone);
  if (pk) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Lead" WHERE "businessId" = ${businessId} AND phone IS NOT NULL
        AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) = ${pk} LIMIT 1`;
    if (rows[0]) return rows[0].id;
  }
  return null;
}

export type UpsertStats = { created: number; duplicates: number; alreadyLeads: number };

/**
 * Stores discovered candidates, merging duplicates instead of creating them. A duplicate fills in
 * fields the first record lacked and remembers the extra source; it never overwrites what is there.
 */
export async function upsertCandidates(
  tx: Tx,
  businessId: string,
  jobId: string | null,
  candidates: Candidate[],
  opts: { autoEnrich: boolean; room?: number }
): Promise<UpsertStats> {
  const stats: UpsertStats = { created: 0, duplicates: 0, alreadyLeads: 0 };
  for (const c of candidates) {
    if (opts.room !== undefined && stats.created >= opts.room) break;
    const site = domainOf(c.website);
    const domain = isCompanySite(site) ? site : null;
    const match = await findExisting(tx, businessId, c, domain);

    if (match) {
      stats.duplicates++;
      const prev = await tx.prospect.findUnique({ where: { id: match.id } });
      if (!prev) continue;
      const sources = ((prev.signals as { sources?: Prisma.InputJsonValue[] } | null)?.sources ?? []) as Prisma.InputJsonValue[];
      await tx.prospect.update({
        where: { id: prev.id },
        data: {
          website: prev.website ?? c.website,
          phone: prev.phone ?? c.phone,
          email: prev.email ?? c.email,
          address: prev.address ?? c.address,
          lat: prev.lat ?? c.lat,
          lon: prev.lon ?? c.lon,
          country: prev.country ?? c.country,
          // Only claim the domain if nobody else holds it (the unique index would refuse otherwise).
          domain: prev.domain ?? (domain && match.how !== "domain" ? await freeDomain(tx, businessId, domain) : null),
          signals: { ...((prev.signals as object) ?? {}), sources: [...sources, { channel: c.channel, externalId: c.externalId, matchedBy: match.how }].slice(-10) },
        },
      });
      continue;
    }

    const leadId = await existingLeadFor(tx, businessId, c, domain);
    const wantsEnrich = opts.autoEnrich && !leadId && Boolean(domain || c.email);
    try {
      await tx.prospect.create({
        data: {
          businessId,
          channel: c.channel,
          externalId: c.externalId,
          name: c.name,
          address: c.address,
          phone: c.phone,
          email: c.email,
          website: c.website,
          category: c.category,
          domain,
          country: c.country,
          lat: c.lat,
          lon: c.lon,
          discoveryJobId: jobId,
          enrichStatus: wantsEnrich ? "pending" : "skipped",
          signals: leadId ? { existingLeadId: leadId } : {},
        },
      });
      stats.created++;
      if (leadId) stats.alreadyLeads++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") stats.duplicates++;
      else throw e;
    }
  }
  return stats;
}

async function freeDomain(tx: Tx, businessId: string, domain: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Prospect" WHERE "businessId" = ${businessId} AND lower("domain") = ${domain} LIMIT 1`;
  return rows.length ? null : domain;
}

/** Writes one enrichment outcome: the scored addresses, the signals, the research note and the status. */
export async function applyEnrichment(tx: Tx, businessId: string, prospectId: string, input: EnrichInput, result: EnrichResult) {
  const prospect = await tx.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect) return;
  const threshold = await getSendThreshold(tx, businessId);

  await tx.prospectEmail.deleteMany({ where: { prospectId } });
  if (result.emails.length) {
    await tx.prospectEmail.createMany({
      data: result.emails.map((e) => ({
        businessId, prospectId, email: e.email, kind: e.kind, source: e.source.slice(0, 300), personName: e.personName,
        mxOk: e.mxOk, catchAll: e.catchAll, smtp: e.smtp, confidence: e.confidence, reasons: e.reasons,
      })),
      skipDuplicates: true,
    });
  }
  const best = result.emails[0];
  const sendable = pickSendable(result.emails, threshold);
  const note = result.status === "done" ? buildResearchNote(input, result) : prospect.researchNote;
  const prevSignals = (prospect.signals as Record<string, unknown> | null) ?? {};

  await tx.prospect.update({
    where: { id: prospectId },
    data: {
      enrichStatus: result.status,
      enrichedAt: new Date(),
      enrichError: result.status === "done" ? null : (result.note ?? null),
      researchNote: note,
      bestEmailConfidence: best?.confidence ?? null,
      // The prospect's own email field only ever holds an address that is good enough to send to.
      email: sendable?.email ?? prospect.email,
      phone: prospect.phone ?? result.signals.phones[0] ?? null,
      signals: { ...prevSignals, ...result.signals },
    },
  });
}
