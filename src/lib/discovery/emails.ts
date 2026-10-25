/**
 * Email intelligence that needs no paid service: role and disposable detection, name-pattern
 * inference, and a confidence score (0-100) that always comes with its reasons.
 *
 * The score is deliberately conservative. A guessed address (a person's name plus a pattern) can
 * only reach the default send threshold if a real SMTP check accepted it on a domain that does not
 * accept everything -- so guesses are never mailed on hope.
 */
export const DEFAULT_SEND_THRESHOLD = 60;

const ROLE = new Set([
  "info", "contact", "hello", "hi", "sales", "office", "admin", "support", "enquiries", "inquiries", "enquiry", "inquiry", "mail",
  "team", "service", "services", "customerservice", "reception", "booking", "bookings", "accounts", "billing", "marketing", "hr",
  "careers", "jobs", "press", "media", "general", "business", "orders",
]);
const NOT_A_PERSON_INBOX = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon", "postmaster", "abuse", "webmaster", "hostmaster", "root",
  "privacy", "dpo", "unsubscribe", "bounce", "bounces", "dmarc", "spam", "security",
]);
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com",
  "sharklasers.com", "getnada.com", "throwawaymail.com", "maildrop.cc", "dispostable.com", "fakeinbox.com", "mintemail.com",
  "mohmal.com", "emailondeck.com", "tempail.com", "mailnesia.com",
]);
const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|gmx|mail|yandex)\.[a-z.]{2,}$/i;

export const localPart = (email: string) => email.split("@")[0].toLowerCase();
export const domainPart = (email: string) => email.split("@")[1].toLowerCase();
export const isRoleLocal = (local: string) => ROLE.has(local.replace(/[._-]/g, ""));
export const isNotPersonInbox = (local: string) => NOT_A_PERSON_INBOX.has(local);
export const isDisposableDomain = (d: string) => DISPOSABLE.has(d.toLowerCase());
export const isFreemailDomain = (d: string) => FREEMAIL.test(d);

// ---- name patterns -------------------------------------------------------------------------------

export type NameParts = { first: string; last: string };
const ascii = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** "Dr. Ada N. Okafor" -> { first: "ada", last: "okafor" }. Needs at least two name parts. */
export function splitName(full: string): NameParts | null {
  const parts = full
    .replace(/\b(dr|mr|mrs|ms|prof|eng|chief|sir|engr)\b\.?/gi, " ")
    .split(/\s+/)
    .map(ascii)
    .filter((p) => p.length > 0);
  const real = parts.filter((p) => p.length > 1);
  if (real.length < 2) return null;
  return { first: real[0], last: real[real.length - 1] };
}

export const PATTERNS = ["first.last", "first", "flast", "f.last", "firstl", "last.first", "first_last", "firstlast", "last"] as const;
export type Pattern = (typeof PATTERNS)[number];

export function applyPattern(p: Pattern, n: NameParts): string {
  const f = n.first, l = n.last;
  switch (p) {
    case "first.last": return `${f}.${l}`;
    case "first": return f;
    case "flast": return `${f[0]}${l}`;
    case "f.last": return `${f[0]}.${l}`;
    case "firstl": return `${f}${l[0]}`;
    case "last.first": return `${l}.${f}`;
    case "first_last": return `${f}_${l}`;
    case "firstlast": return `${f}${l}`;
    case "last": return l;
  }
}

/** Which pattern explains the personal addresses we actually saw on this domain? Needs a clear winner. */
export function inferPattern(known: { email: string; personName: string }[], domain: string): Pattern | null {
  const votes = new Map<Pattern, number>();
  for (const k of known) {
    if (domainPart(k.email) !== domain) continue;
    const parts = splitName(k.personName);
    if (!parts) continue;
    const local = localPart(k.email);
    for (const p of PATTERNS) if (applyPattern(p, parts) === local) votes.set(p, (votes.get(p) ?? 0) + 1);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null; // ambiguous
  return ranked[0][0];
}

/**
 * The address to mail for a prospect: among those at or above the threshold, a named person's
 * address beats a shared role inbox (info@), then the higher confidence wins. Null if none qualify.
 */
export function pickSendable<T extends { email: string; kind: string; confidence: number }>(list: T[], threshold: number): T | null {
  const ok = list.filter((e) => e.confidence >= threshold);
  ok.sort((a, b) => Number(a.kind === "role") - Number(b.kind === "role") || b.confidence - a.confidence);
  return ok[0] ?? null;
}

// ---- confidence -------------------------------------------------------------------------------------------

export type EmailKind = "found" | "role" | "pattern_guess";
export type Via = "mailto" | "text" | "jsonld" | "cloudflare" | "obfuscated" | "osm" | "pattern";

export type ScoreInput = {
  email: string;
  via: Via;
  kind: EmailKind;
  siteDomain: string | null;
  mxOk: boolean | null;
  smtp: "unchecked" | "accepted" | "rejected" | "unknown";
  catchAll: boolean | null;
  pagesSeen: number;
  hasPersonName: boolean;
  patternObserved: boolean;
};

const BASE: Record<Via, number> = { mailto: 78, jsonld: 78, cloudflare: 75, text: 68, obfuscated: 62, osm: 70, pattern: 30 };

export function scoreEmail(i: ScoreInput): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  const local = localPart(i.email);
  const domain = domainPart(i.email);
  let score = BASE[i.via];
  reasons.push(
    i.via === "pattern" ? "Guessed from a name and an address pattern; not seen published." :
    i.via === "osm" ? "Listed on the business's OpenStreetMap entry." :
    i.via === "obfuscated" ? "Published on the company site in a disguised form." :
    "Published on the company's own website."
  );
  let cap = 95; // never claim certainty without a real delivery

  if (i.siteDomain && domain === i.siteDomain) { score += 8; reasons.push("Address is on the company's own domain."); }
  else if (isFreemailDomain(domain)) { score -= 4; reasons.push("Free-mail address (common for small firms, but not company-owned)."); }
  else if (i.siteDomain) { score -= 8; reasons.push("Address is on a different domain from the website."); }

  if (i.hasPersonName && i.via !== "pattern") { score += 4; reasons.push("Tied to a named person."); }
  if (i.pagesSeen > 1) { score += 4; reasons.push("Seen on more than one page."); }
  if (i.via === "pattern" && i.patternObserved) { score += 15; reasons.push("Matches the address pattern seen for other people at this company."); }

  if (i.mxOk === true) { score += 4; reasons.push("The domain accepts mail (MX found)."); }
  if (i.mxOk === false) { cap = Math.min(cap, 5); reasons.push("The domain has no mail records; mail would bounce."); }

  if (isDisposableDomain(domain)) { cap = Math.min(cap, 5); reasons.push("Disposable-mail domain."); }
  if (isNotPersonInbox(local)) { cap = Math.min(cap, 5); reasons.push("Automated or technical mailbox, not a person."); }
  else if (i.kind === "role" || isRoleLocal(local)) reasons.push("Role address: reaches a shared inbox, not a named person.");

  if (i.smtp === "accepted") {
    if (i.catchAll === true) { cap = Math.min(cap, 62); reasons.push("Mail server accepted it but accepts every address, so this proves nothing."); }
    else { score += 20; reasons.push("The mail server confirmed this mailbox exists."); }
  } else if (i.smtp === "rejected") { cap = Math.min(cap, 5); reasons.push("The mail server said this mailbox does not exist."); }

  if (i.via === "pattern" && i.smtp !== "accepted") {
    cap = Math.min(cap, DEFAULT_SEND_THRESHOLD - 3);
    reasons.push("A guess that was not confirmed, so it will not be used for sending.");
  }

  const confidence = Math.max(0, Math.min(cap, Math.round(score)));
  return { confidence, reasons };
}
