import { detectTechFromHtml } from "@/lib/prospecting/tech-stack";
import { domainAcceptsMail } from "@/lib/email-campaigns/mx";
import { extractFacts, type Person } from "./extract";
import {
  applyPattern, domainPart, inferPattern, isNotPersonInbox, isRoleLocal, localPart, scoreEmail, splitName,
  type EmailKind, type Pattern, type Via,
} from "./emails";
import { domainOf, isCompanySite } from "./normalize";
import { PoliteCrawler } from "./web";
import { archivedPages } from "./commoncrawl";
import { probeConfigured, probeMailbox, type ProbeResult } from "./smtp-probe";

export type EnrichInput = {
  name: string;
  website?: string | null;
  /** An address the source itself published (an OSM tag, a Places field). */
  knownEmail?: string | null;
  category?: string | null;
  address?: string | null;
  phone?: string | null;
};

export type ScoredEmail = {
  email: string;
  kind: EmailKind;
  source: string;
  personName: string | null;
  mxOk: boolean | null;
  catchAll: boolean | null;
  smtp: "unchecked" | "accepted" | "rejected" | "unknown";
  confidence: number;
  reasons: string[];
};

export type EnrichResult = {
  status: "done" | "skipped" | "failed";
  note?: string; // why skipped/failed
  domain: string | null;
  emails: ScoredEmail[];
  signals: {
    title: string | null;
    description: string | null;
    siteName: string | null;
    lang: string | null;
    tech: string[];
    people: Person[];
    phones: string[];
    socials: string[];
    pagesRead: string[];
    pagesBlocked: { url: string; reason: string }[];
    /** Archived pages used because the live site was unreachable. */
    archived?: string[];
  };
};

export type EnrichDeps = {
  crawler?: PoliteCrawler;
  mxCheck?: (domain: string) => Promise<boolean>;
  probe?: (email: string) => Promise<ProbeResult>;
  probeEnabled?: boolean;
  maxPages?: number;
  /** Archived pages for a domain whose live site is unreachable. Default: Common Crawl. null turns it off. */
  archive?: ((domain: string) => Promise<{ url: string; html: string }[]>) | null;
};

const emptySignals = (): EnrichResult["signals"] => ({ title: null, description: null, siteName: null, lang: null, tech: [], people: [], phones: [], socials: [], pagesRead: [], pagesBlocked: [] });

const PAGE_PRIORITY = (u: string) => (/contact|kontakt/i.test(u) ? 0 : /team|people|staff|leadership|management/i.test(u) ? 1 : /about|company|story/i.test(u) ? 2 : 3);

type Seen = { vias: Set<Via>; pages: Set<string>; personName: string | null };

export async function enrichProspect(input: EnrichInput, deps: EnrichDeps = {}): Promise<EnrichResult> {
  const domain = domainOf(input.website);
  const signals = emptySignals();
  const seen = new Map<string, Seen>();
  const note = (email: string, via: Via, page: string, personName?: string | null) => {
    const s = seen.get(email) ?? { vias: new Set<Via>(), pages: new Set<string>(), personName: null };
    s.vias.add(via);
    s.pages.add(page);
    if (personName && !s.personName) s.personName = personName;
    seen.set(email, s);
  };

  if (input.knownEmail) note(input.knownEmail.toLowerCase(), "osm", "source");

  if (!domain || !isCompanySite(domain)) {
    if (!seen.size) return { status: "skipped", note: "No company website to read.", domain: null, emails: [], signals };
  } else {
    const crawler = deps.crawler ?? new PoliteCrawler();
    const maxPages = deps.maxPages ?? 5;
    const start = (input.website!.startsWith("http") ? input.website! : `https://${domain}/`);
    const queue: string[] = [start];
    const visited = new Set<string>();
    const people: Person[] = [];
    let homepageOk = false;

    while (queue.length && visited.size < maxPages) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      let page = await crawler.get(url);
      if (!page.ok && visited.size === 1 && url.startsWith("https://") && page.reason === "unreachable") {
        page = await crawler.get(url.replace(/^https:/, "http:")); // some small sites have no TLS
      }
      if (!page.ok) {
        signals.pagesBlocked.push({ url, reason: page.reason });
        continue;
      }
      if (visited.size === 1) homepageOk = true;
      signals.pagesRead.push(page.url);
      const facts = extractFacts(page.html, page.url);
      if (visited.size === 1) {
        signals.title = facts.title;
        signals.description = facts.description;
        signals.siteName = facts.siteName;
        signals.lang = facts.lang;
        signals.tech = detectTechFromHtml(page.html);
      }
      for (const e of facts.emails) note(e.email, e.via, page.url, e.personName);
      people.push(...facts.people);
      for (const ph of facts.phones) if (!signals.phones.includes(ph)) signals.phones.push(ph);
      for (const so of facts.socials) if (!signals.socials.includes(so) && signals.socials.length < 8) signals.socials.push(so);
      for (const link of facts.contactLinks.sort((a, b) => PAGE_PRIORITY(a) - PAGE_PRIORITY(b))) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }
    // The live site cannot be reached at all (not: it told us to stay out): try an archived copy.
    const unreachable = !homepageOk && signals.pagesBlocked.length > 0 && signals.pagesBlocked.every((p) => p.reason === "unreachable");
    if (unreachable && deps.archive !== null) {
      try {
        for (const a of await (deps.archive ?? ((d: string) => archivedPages(d)))(domain)) {
          const facts = extractFacts(a.html, a.url);
          for (const e of facts.emails) note(e.email, "archive", a.url, e.personName);
          people.push(...facts.people);
          for (const ph of facts.phones) if (!signals.phones.includes(ph)) signals.phones.push(ph);
          signals.archived = [...(signals.archived ?? []), a.url];
        }
      } catch {
        /* the archive is a bonus; fall through to "could not be reached" */
      }
    }
    signals.people = [...new Map(people.map((p) => [p.name.toLowerCase(), p])).values()].slice(0, 12);
    if (!homepageOk && !seen.size) {
      const why = signals.pagesBlocked[0]?.reason;
      return {
        status: why === "robots" ? "skipped" : "failed",
        note: why === "robots" ? "The site's robots.txt asks crawlers not to read it, so it was left alone." : "The website could not be reached.",
        domain,
        emails: [],
        signals,
      };
    }
  }

  // Tie addresses to people: an address on the page next to a name, or whose local part is that name.
  for (const p of signals.people) {
    if (p.email && seen.has(p.email)) seen.get(p.email)!.personName ??= p.name;
  }
  for (const [email, s] of seen) {
    if (s.personName || isRoleLocal(localPart(email)) || isNotPersonInbox(localPart(email))) continue;
    for (const p of signals.people) {
      const parts = splitName(p.name);
      if (!parts) continue;
      const local = localPart(email);
      if ([parts.first, `${parts.first}.${parts.last}`, `${parts.first[0]}${parts.last}`, `${parts.first}${parts.last[0]}`].includes(local)) {
        s.personName = p.name;
        break;
      }
    }
  }

  // Guess addresses for named people with no published address -- only when it can be justified.
  const guesses: { email: string; personName: string; pattern: Pattern; observed: boolean }[] = [];
  if (domain && isCompanySite(domain)) {
    const known = [...seen.entries()].filter(([, s]) => s.personName).map(([email, s]) => ({ email, personName: s.personName! }));
    const observed = inferPattern(known, domain);
    const probing = (deps.probeEnabled ?? probeConfigured()) === true;
    const have = new Set(known.map((k) => k.personName.toLowerCase()));
    for (const p of signals.people.filter((x) => !have.has(x.name.toLowerCase())).slice(0, 4)) {
      const parts = splitName(p.name);
      if (!parts) continue;
      const patterns: Pattern[] = observed ? [observed] : probing ? ["first.last", "first", "flast"] : [];
      for (const pat of patterns) guesses.push({ email: `${applyPattern(pat, parts)}@${domain}`, personName: p.name, pattern: pat, observed: Boolean(observed) });
    }
  }

  const all = new Map<string, { kind: EmailKind; via: Via; source: string; personName: string | null; pagesSeen: number; observed: boolean }>();
  for (const [email, s] of seen) {
    const via: Via = ([...s.vias].find((v) => v !== "osm" && v !== "text") ?? [...s.vias][0]) as Via;
    const kind: EmailKind = isRoleLocal(localPart(email)) ? "role" : "found";
    all.set(email, { kind, via, source: [...s.pages][0], personName: s.personName, pagesSeen: s.pages.size, observed: false });
  }
  for (const g of guesses) {
    if (!all.has(g.email)) all.set(g.email, { kind: "pattern_guess", via: "pattern", source: `pattern:${g.pattern}`, personName: g.personName, pagesSeen: 1, observed: g.observed });
  }

  // Deliverability checks: one MX lookup per domain, then the optional mailbox probe (capped).
  const mxCheck = deps.mxCheck ?? domainAcceptsMail;
  const mx = new Map<string, boolean>();
  for (const d of new Set([...all.keys()].map(domainPart))) mx.set(d, await mxCheck(d).catch(() => true));
  const probing = deps.probeEnabled ?? probeConfigured();
  const probe = deps.probe ?? ((e: string) => probeMailbox(e));
  let probed = 0;

  const emails: ScoredEmail[] = [];
  for (const [email, a] of all) {
    const mxOk = mx.get(domainPart(email)) ?? null;
    let smtp: ScoredEmail["smtp"] = "unchecked";
    let catchAll: boolean | null = null;
    if (probing && mxOk && probed < 6 && !isNotPersonInbox(localPart(email)) && (a.kind === "pattern_guess" || domainPart(email) === domain)) {
      probed++;
      const r = await probe(email).catch(() => ({ smtp: "unknown" as const, catchAll: null }));
      smtp = r.smtp;
      catchAll = r.catchAll;
    }
    const { confidence, reasons } = scoreEmail({
      email, via: a.via, kind: a.kind, siteDomain: domain, mxOk, smtp, catchAll,
      pagesSeen: a.pagesSeen, hasPersonName: Boolean(a.personName), patternObserved: a.observed,
    });
    emails.push({ email, kind: a.kind, source: a.source, personName: a.personName, mxOk, catchAll, smtp, confidence, reasons });
  }
  emails.sort((x, y) => y.confidence - x.confidence);
  return { status: "done", domain, emails, signals };
}
