import { gunzipSync } from "node:zlib";
import { USER_AGENT, type FetchLike } from "./osm";

/**
 * Common Crawl fallback: when a company's own site cannot be reached at all, look for an archived
 * copy of its contact / about / team pages in the public Common Crawl index.
 *
 * Deliberately narrow:
 *  - used ONLY when the live site is unreachable, never to read pages a robots.txt told us not to;
 *  - a handful of pages, fetched with byte-range requests (a few KB each, not whole archive files);
 *  - what it yields is marked as archived and scores below the send threshold unless a mailbox check
 *    confirms it, because an archived address may be years out of date.
 */
const INDEX_BASE = process.env.COMMONCRAWL_INDEX ?? "https://index.commoncrawl.org";
const DATA_BASE = process.env.COMMONCRAWL_DATA ?? "https://data.commoncrawl.org";
const WANTED_RE = /(contact|about|team|people|staff|leadership|impressum|kontakt)/i;

type Collection = { id: string };
type CdxRecord = { url: string; filename: string; offset: string; length: string; status?: string; mime?: string };

let latest: { id: string; at: number } | null = null;

async function latestCollection(fetchFn: FetchLike): Promise<string> {
  if (latest && Date.now() - latest.at < 24 * 3600_000) return latest.id;
  const res = await fetchFn(`${INDEX_BASE}/collinfo.json`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Common Crawl index list returned ${res.status}.`);
  const list = (await res.json()) as Collection[];
  if (!list[0]?.id) throw new Error("Common Crawl returned no collections.");
  latest = { id: list[0].id, at: Date.now() };
  return latest.id;
}

/** Pulls the HTML body out of one gzip-compressed WARC response record. */
export function bodyFromWarcRecord(gz: Buffer): string | null {
  let raw: Buffer;
  try {
    raw = gunzipSync(gz);
  } catch {
    return null;
  }
  const text = raw.toString("utf8");
  const warcEnd = text.indexOf("\r\n\r\n");
  if (warcEnd < 0) return null;
  const httpPart = text.slice(warcEnd + 4);
  const httpEnd = httpPart.indexOf("\r\n\r\n");
  if (httpEnd < 0) return null;
  const head = httpPart.slice(0, httpEnd);
  // Common Crawl stores the already-decoded body and keeps the original header as
  // "X-Crawler-Content-Encoding", so only a header that starts its own line means "still compressed".
  if (!/^HTTP\/\d(\.\d)? 200/.test(head) || /^content-encoding:\s*(gzip|br|deflate)/im.test(head)) return null;
  if (!/content-type:\s*text\/html/i.test(head)) return null;
  return httpPart.slice(httpEnd + 4, httpEnd + 4 + 1_500_000);
}

export type ArchivedPage = { url: string; html: string };

export async function archivedPages(domain: string, fetchFn: FetchLike = fetch, maxPages = 4): Promise<ArchivedPage[]> {
  const id = await latestCollection(fetchFn);
  // The index's own URL-regex filter is slow and times out under load, so only status and type are
  // filtered there; contact-like pages are picked from the (small) result below.
  const q = new URLSearchParams({ url: `${domain}/*`, output: "json", limit: "100", fl: "url,filename,offset,length,status,mime" });
  q.append("filter", "status:200");
  q.append("filter", "mime:text/html");
  const res = await fetchFn(`${INDEX_BASE}/${id}-index?${q}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(25_000) });
  if (res.status === 404) return []; // not in this crawl
  if (!res.ok) throw new Error(`Common Crawl index returned ${res.status}.`);
  const records = (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as CdxRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is CdxRecord => Boolean(r?.filename && r.offset && r.length));

  // One page per distinct path, contact pages first.
  const seen = new Set<string>();
  const ordered = records
    .filter((r) => {
      let key: string;
      try {
        key = new URL(r.url).pathname.replace(/\/$/, "").toLowerCase();
      } catch {
        return false;
      }
      if (!WANTED_RE.test(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(!/contact|kontakt/i.test(a.url)) - Number(!/contact|kontakt/i.test(b.url)))
    .slice(0, maxPages);

  const pages: ArchivedPage[] = [];
  for (const r of ordered) {
    const start = Number(r.offset);
    const len = Number(r.length);
    if (!Number.isFinite(start) || !Number.isFinite(len) || len <= 0 || len > 2_000_000) continue;
    const got = await fetchFn(`${DATA_BASE}/${r.filename}`, {
      headers: { "User-Agent": USER_AGENT, Range: `bytes=${start}-${start + len - 1}` },
      signal: AbortSignal.timeout(25_000),
    });
    if (got.status !== 206 && got.status !== 200) continue;
    const html = bodyFromWarcRecord(Buffer.from(await got.arrayBuffer()));
    if (html) pages.push({ url: r.url, html });
  }
  return pages;
}

export const _resetCommonCrawlCache = () => {
  latest = null;
};
