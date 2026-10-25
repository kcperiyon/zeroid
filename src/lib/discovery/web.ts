import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";

/**
 * Polite, SSRF-safe page fetching for enrichment. We fetch other people's websites on behalf of a
 * tenant, so three things are enforced here and nowhere else gets to skip them:
 *  1. the connection address is checked when the socket is opened (a private, loopback or
 *     link-local address is refused, which also defeats DNS rebinding);
 *  2. robots.txt is honoured (our own user-agent group first, then *), including Crawl-delay;
 *  3. one host is never hit faster than the delay, and responses are size- and time-capped.
 */
export const BOT_TOKEN = "ZeroidBot";
export const BOT_UA = process.env.CRAWLER_USER_AGENT ?? "ZeroidBot/1.0 (+https://zeroid.moneyvarsity.net/bot)";

export type WebOptions = {
  /** Tests only: allow loopback and non-standard ports. Never set from user input. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
};

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(address)) {
    const v = address.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return true; // not an IP at all: treat as unsafe
}

export type WebResponse = { status: number; contentType: string; body: string; finalUrl: string };

export class BlockedError extends Error {}

function getOnce(url: URL, opts: Required<WebOptions>): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers: { "User-Agent": BOT_UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1", "Accept-Encoding": "identity" },
        timeout: opts.timeoutMs,
        // Runs on every connection, so the address that is actually dialled is the one checked.
        lookup: (hostname, options, callback) => {
          // Node may ask for every address (options.all) or just one; answer in the shape it asked for.
          dns.lookup(hostname, options, (err, address, family) => {
            if (err) return callback(err, "", 0);
            const list: { address: string; family: number }[] = Array.isArray(address) ? address : [{ address, family: family as number }];
            if (!opts.allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
              return callback(new BlockedError(`Refused to connect to a private address (${hostname}).`), "", 0);
            }
            if (options.all) return (callback as unknown as (e: null, all: typeof list) => void)(null, list);
            callback(null, list[0].address, list[0].family);
          });
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, contentType, body: "" });
        }
        if (contentType && !/text\/|html|xml|json/i.test(contentType)) {
          res.destroy();
          return resolve({ status, contentType, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            return resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") });
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Timed out.")));
    req.on("error", reject);
    req.end();
  });
}

/** GET with manual redirects (each hop re-validated), size and time caps. Throws on network errors. */
export async function safeGet(rawUrl: string, options: WebOptions = {}): Promise<WebResponse> {
  const opts: Required<WebOptions> = { allowPrivate: false, timeoutMs: 8000, maxBytes: 1_500_000, ...options };
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedError("Only http and https are fetched.");
    if (!opts.allowPrivate) {
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      if (port !== "80" && port !== "443") throw new BlockedError("Only standard web ports are fetched.");
      if (url.username || url.password) throw new BlockedError("URLs with credentials are not fetched.");
      if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) throw new BlockedError("Refused to fetch a private address.");
    }
    const r = await getOnce(url, opts);
    if (r.status >= 300 && r.status < 400 && r.location) {
      url = new URL(r.location, url);
      continue;
    }
    return { status: r.status, contentType: r.contentType, body: r.body, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects.");
}

// ---- robots.txt ----------------------------------------------------------------------------

export type Robots = { allows: (path: string) => boolean; crawlDelaySec: number | null };
export const ALLOW_ALL: Robots = { allows: () => true, crawlDelaySec: null };
export const DISALLOW_ALL: Robots = { allows: () => false, crawlDelaySec: null };

const ruleToRegex = (rule: string) =>
  new RegExp("^" + rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));

/** Parses robots.txt for our token (falling back to the * group). Longest matching rule wins; Allow wins ties. */
export function parseRobots(text: string, token = BOT_TOKEN): Robots {
  type Group = { agents: string[]; rules: { allow: boolean; re: RegExp; len: number }[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if ((field === "allow" || field === "disallow") && value !== "") {
      cur.rules.push({ allow: field === "allow", re: ruleToRegex(value), len: value.length });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) cur.delay = n;
    }
  }
  const t = token.toLowerCase();
  const group = groups.find((g) => g.agents.some((a) => a !== "*" && t.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return ALLOW_ALL;
  return {
    crawlDelaySec: group.delay,
    allows: (path: string) => {
      let best: { allow: boolean; len: number } | null = null;
      for (const r of group.rules) {
        if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = { allow: r.allow, len: r.len };
      }
      return best ? best.allow : true;
    },
  };
}

// ---- polite crawler ----------------------------------------------------------------------------

export type PageResult =
  | { ok: true; url: string; html: string }
  | { ok: false; url: string; reason: "robots" | "unreachable" | "blocked" | "status" | "not_html"; detail?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PoliteCrawler {
  private robots = new Map<string, Robots | "unreachable">();
  private lastHit = new Map<string, number>();
  constructor(private opts: WebOptions & { minDelayMs?: number; maxDelayMs?: number; fetchPage?: typeof safeGet } = {}) {}

  private get fetchPage() {
    return this.opts.fetchPage ?? safeGet;
  }

  private async wait(host: string, delayMs: number) {
    const last = this.lastHit.get(host) ?? 0;
    const gap = Date.now() - last;
    if (gap < delayMs) await sleep(delayMs - gap);
    this.lastHit.set(host, Date.now());
  }

  private async robotsFor(origin: string): Promise<Robots | "unreachable"> {
    const cached = this.robots.get(origin);
    if (cached) return cached;
    let r: Robots | "unreachable";
    try {
      await this.wait(new URL(origin).host, this.opts.minDelayMs ?? 1500);
      const res = await this.fetchPage(`${origin}/robots.txt`, this.opts);
      if (res.status >= 500) r = DISALLOW_ALL; // site is struggling: stay away rather than guess
      else if (res.status >= 400) r = ALLOW_ALL; // no robots.txt = no restrictions
      else r = parseRobots(res.body);
    } catch {
      r = "unreachable"; // includes addresses we refuse to connect to
    }
    this.robots.set(origin, r);
    return r;
  }

  async get(rawUrl: string): Promise<PageResult> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, url: rawUrl, reason: "blocked", detail: "Invalid URL." };
    }
    const robots = await this.robotsFor(url.origin);
    if (robots === "unreachable") return { ok: false, url: rawUrl, reason: "unreachable" };
    if (!robots.allows(url.pathname + url.search)) return { ok: false, url: rawUrl, reason: "robots" };
    const min = this.opts.minDelayMs ?? 1500;
    const max = this.opts.maxDelayMs ?? 10_000;
    const delay = Math.min(max, Math.max(min, (robots.crawlDelaySec ?? 0) * 1000));
    try {
      await this.wait(url.host, delay);
      const res = await this.fetchPage(rawUrl, this.opts);
      if (res.status >= 400) return { ok: false, url: rawUrl, reason: "status", detail: String(res.status) };
      if (!res.body) return { ok: false, url: rawUrl, reason: "not_html" };
      return { ok: true, url: res.finalUrl, html: res.body };
    } catch (e) {
      if (e instanceof BlockedError) return { ok: false, url: rawUrl, reason: "blocked", detail: e.message };
      return { ok: false, url: rawUrl, reason: "unreachable", detail: (e as Error).message };
    }
  }
}
