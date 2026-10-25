/**
 * Pulls contact facts out of one HTML page the company itself publishes. Pure functions over a
 * string, so everything here is testable without a network. Nothing is fetched from social
 * networks: their links are only recorded, never followed.
 */
export type FoundEmail = { email: string; via: "mailto" | "text" | "jsonld" | "cloudflare" | "obfuscated"; personName?: string };
export type Person = { name: string; title?: string; email?: string };
export type PageFacts = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  lang: string | null;
  emails: FoundEmail[];
  people: Person[];
  phones: string[];
  socials: string[];
  contactLinks: string[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", commat: "@", period: ".", lowbar: "_", hyphen: "-" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Cloudflare "email protection": hex string where the first byte is an XOR key for the rest. */
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out.includes("@") ? out : null;
}

const JUNK_DOMAINS = /(^|\.)(example\.(com|org|net)|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|domain\.com|email\.com|yourdomain\.com|yoursite\.com|test\.com|localhost)$/i;
const FILE_LIKE_TLD = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|pdf|mp4)$/i;

/** Lowercases and validates an address; returns null for things that merely look like one. */
export function cleanEmail(raw: string): string | null {
  const e = decodeEntities(raw).trim().replace(/^mailto:/i, "").split("?")[0].replace(/[),.;:>'"\]]+$/, "").replace(/^[<('"[]+/, "").toLowerCase();
  if (e.length > 120 || !/^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(e)) return null;
  if (FILE_LIKE_TLD.test(e)) return null;
  if (/@\d+x\./.test(e) || /^\d+x\d+/.test(e)) return null; // logo@2x.png style names
  const domain = e.split("@")[1];
  if (JUNK_DOMAINS.test(domain)) return null;
  if (/^(you|your|name|email|user|username|someone|john\.?doe|jane\.?doe)@/.test(e)) return null; // template placeholders
  return e;
}

function stripToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|td|dd|dt)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

const attr = (tag: string, name: string) => decodeEntities(tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((v) => v !== undefined) ?? "");

function metaContent(html: string, key: string, value: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attr(m[0], key).toLowerCase() === value) {
      const c = attr(m[0], "content").trim();
      if (c) return c.slice(0, 400);
    }
  }
  return null;
}

// ---- JSON-LD ------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
function walk(node: unknown, visit: (o: Json) => void, depth = 0) {
  if (depth > 8 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, depth + 1));
  visit(node as Json);
  for (const v of Object.values(node as Json)) walk(v, visit, depth + 1);
}
const types = (o: Json) => ([] as unknown[]).concat(o["@type"] ?? []).map(String);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function readJsonLd(html: string) {
  const emails: FoundEmail[] = [];
  const people: Person[] = [];
  const phones: string[] = [];
  const socials: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(decodeEntities(m[1]).trim());
    } catch {
      continue;
    }
    walk(data, (o) => {
      const t = types(o);
      const email = cleanEmail(str(o.email));
      if (t.some((x) => /Person/i.test(x))) {
        const name = str(o.name);
        if (name) people.push({ name, title: str(o.jobTitle) || undefined, email: email ?? undefined });
        if (email) emails.push({ email, via: "jsonld", personName: name || undefined });
      } else if (email) {
        emails.push({ email, via: "jsonld" });
      }
      if (str(o.telephone)) phones.push(str(o.telephone));
      for (const s of ([] as unknown[]).concat(o.sameAs ?? [])) if (typeof s === "string") socials.push(s);
    });
  }
  return { emails, people, phones, socials };
}

// ---- people from visible text ---------------------------------------------------------------------

const TITLES = "(?:CEO|CFO|COO|CTO|CMO|Chief [A-Z][a-z]+ Officer|Founder|Co-?founder|Owner|Co-?owner|Managing Director|Director|Principal|Partner|Managing Partner|President|Vice President|Head of [A-Z][A-Za-z ]{2,24}|Manager|General Manager|Proprietor)";
const NAME = "([A-Z][a-z'’-]{1,20}(?: [A-Z]\\.?)?(?: [A-Z][a-z'’-]{1,24}){1,2})";
const NAME_FIRST = new RegExp(`${NAME}\\s*(?:,|\\||–|—|-|:|\\n)\\s*(${TITLES})\\b`, "g");
const TITLE_FIRST = new RegExp(`\\b(${TITLES})\\s*(?:,|\\||–|—|-|:|\\n)\\s*${NAME}`, "g");
const NOT_NAMES = /^(Contact|About|Our|The|Meet|Read|Learn|Get|Send|Call|Privacy|Terms|Cookie|Follow|Join|Chief|Managing|General|Vice|Head|Sales|Customer|Business|Professional)\b/;

export function extractPeople(text: string): Person[] {
  const found = new Map<string, Person>();
  const add = (name: string, title: string) => {
    const n = name.trim();
    if (NOT_NAMES.test(n) || n.split(" ").length < 2) return;
    const key = n.toLowerCase();
    if (!found.has(key)) found.set(key, { name: n, title: title.trim() });
  };
  for (const m of text.matchAll(NAME_FIRST)) add(m[1], m[2]);
  for (const m of text.matchAll(TITLE_FIRST)) add(m[2], m[1]);
  return [...found.values()].slice(0, 12);
}

// ---- obfuscated addresses ----------------------------------------------------------------------------

function obfuscatedEmails(text: string): string[] {
  const out: string[] = [];
  const dot = String.raw`(?:\s*[\[({]\s*dot\s*[\])}]\s*|\.)`;
  const re = new RegExp(String.raw`([a-z0-9._%+-]{1,64})\s*[\[({]\s*(?:at|@)\s*[\])}]\s*([a-z0-9-]+(?:${dot}[a-z0-9-]+)+)`, "gi");
  for (const m of text.matchAll(re)) {
    const domain = m[2].replace(/\s*[\[({]\s*dot\s*[\])}]\s*/gi, ".");
    const e = cleanEmail(`${m[1]}@${domain}`);
    if (e) out.push(e);
  }
  return out;
}

// ---- main ----------------------------------------------------------------------------------------------

const CONTACT_PATH = /(contact|about|team|people|staff|leadership|management|our-story|who-we-are|impressum|imprint|kontakt|equipe|nosotros|company)/i;
const SOCIAL = /^https?:\/\/(www\.)?(linkedin\.com\/(company|in)\/|facebook\.com\/|instagram\.com\/|twitter\.com\/|x\.com\/|youtube\.com\/(@|c\/|channel\/|user\/)|tiktok\.com\/@)/i;

export function extractFacts(html: string, pageUrl: string): PageFacts {
  const emails: FoundEmail[] = [];
  const seen = new Set<string>();
  const push = (e: FoundEmail) => {
    if (!seen.has(e.email)) {
      seen.add(e.email);
      emails.push(e);
    }
  };

  const ld = readJsonLd(html);
  ld.emails.forEach(push);

  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href").trim();
    if (!href) continue;
    if (/^mailto:/i.test(href)) {
      const e = cleanEmail(href);
      if (e) push({ email: e, via: "mailto" });
    } else if (/^tel:/i.test(href)) {
      ld.phones.push(decodeURIComponent(href.slice(4)).trim());
    } else {
      links.push(href);
    }
  }
  for (const m of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) {
    const e = decodeCloudflareEmail(m[1]);
    const clean = e && cleanEmail(e);
    if (clean) push({ email: clean, via: "cloudflare" });
  }

  const text = stripToText(html);
  for (const m of text.matchAll(/[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi)) {
    const e = cleanEmail(m[0]);
    if (e) push({ email: e, via: "text" });
  }
  for (const e of obfuscatedEmails(text)) push({ email: e, via: "obfuscated" });

  const people = [...ld.people, ...extractPeople(text)];
  const dedupPeople = [...new Map(people.map((p) => [p.name.toLowerCase(), p])).values()].slice(0, 12);

  let origin: URL | null = null;
  try {
    origin = new URL(pageUrl);
  } catch {
    /* leave null */
  }
  const socials = new Set<string>();
  const contactLinks = new Set<string>();
  for (const href of [...links, ...ld.socials]) {
    if (SOCIAL.test(href)) {
      if (socials.size < 8) socials.add(href.split("#")[0].slice(0, 200));
      continue;
    }
    if (!origin) continue;
    try {
      const u = new URL(href, origin);
      if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.replace(/^www\./, "") === origin.hostname.replace(/^www\./, "") && CONTACT_PATH.test(u.pathname) && u.pathname.length < 80) {
        u.hash = "";
        u.search = "";
        contactLinks.add(u.toString());
      }
    } catch {
      /* ignore bad hrefs */
    }
  }

  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  return {
    title,
    description: metaContent(html, "name", "description") ?? metaContent(html, "property", "og:description"),
    siteName: metaContent(html, "property", "og:site_name"),
    lang: html.match(/<html[^>]*\blang\s*=\s*["']?([a-zA-Z-]{2,10})/i)?.[1] ?? null,
    emails,
    people: dedupPeople,
    phones: [...new Set(ld.phones.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.replace(/\D/g, "").length >= 7))].slice(0, 5),
    socials: [...socials],
    contactLinks: [...contactLinks].slice(0, 12),
  };
}
