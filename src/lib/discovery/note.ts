import type { EnrichInput, EnrichResult } from "./enrich";

/**
 * A short, factual research note per prospect, built only from what discovery and the crawl really
 * saw. It states nothing it cannot back up, so it is safe to show a person and safe to hand to the
 * AI personaliser as source material. No AI call, no cost.
 */
export function buildResearchNote(input: EnrichInput, result: Pick<EnrichResult, "domain" | "emails" | "signals">): string {
  const s = result.signals;
  const parts: string[] = [];

  const what = [input.category, input.address ? `in ${input.address}` : null].filter(Boolean).join(" ");
  parts.push(`${input.name}${what ? ` is listed as ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}` : ""}.`);

  if (s.description) parts.push(`Their site describes them as: "${s.description.slice(0, 220)}"`);
  else if (s.title) parts.push(`Site title: "${s.title.slice(0, 120)}".`);

  if (s.tech.length) parts.push(`Their site runs on ${s.tech.slice(0, 5).join(", ")}.`);

  if (s.people.length) {
    parts.push(`People named on their site: ${s.people.slice(0, 4).map((p) => (p.title ? `${p.name} (${p.title})` : p.name)).join("; ")}.`);
  }

  const best = result.emails[0];
  if (best) {
    parts.push(
      best.confidence >= 60
        ? `Best contact: ${best.email}${best.personName ? ` (${best.personName})` : ""}, confidence ${best.confidence}/100. ${best.reasons[0]}`
        : `No address reliable enough to mail yet; best candidate ${best.email} scored ${best.confidence}/100.`
    );
  } else if (result.domain) {
    parts.push("No email address was found on their public pages.");
  }

  if (s.phones.length) parts.push(`Phone: ${s.phones[0]}.`);
  if (s.socials.length) parts.push(`Public profiles linked from their site: ${s.socials.slice(0, 3).join(", ")}.`);
  if (s.pagesBlocked.some((p) => p.reason === "robots")) parts.push("Some pages were not read because the site's robots.txt asks crawlers to stay out.");

  return parts.join(" ").slice(0, 1200);
}
