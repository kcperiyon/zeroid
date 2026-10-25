import { Resolver } from "node:dns/promises";

/**
 * Free deliverability pre-check: does the recipient domain accept mail at all (MX record, or an A
 * record as the SMTP fallback)? Sending to a dead domain only produces a bounce, which hurts
 * sender reputation.
 *
 * Designed so a slow or broken resolver can never stall a launch or silently drop real prospects:
 *  - one short lookup per UNIQUE domain, run in parallel (never one-by-one per lead);
 *  - a hard timeout per lookup (default 4 s, 1 try);
 *  - only a definite "this domain does not exist / has no mail records" counts as invalid --
 *    timeouts and resolver errors count as OK;
 *  - results cached per process.
 */
const cache = new Map<string, { ok: boolean; at: number }>();
const TTL_MS = 6 * 60 * 60_000;
const LOOKUP_TIMEOUT_MS = Number(process.env.MX_TIMEOUT_MS ?? 4000);

const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 });

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const d = domain.trim().toLowerCase();
  const hit = cache.get(d);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;

  let ok = true;
  try {
    ok = (await resolver.resolveMx(d)).length > 0;
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (NOT_FOUND.has(code)) {
      try {
        ok = (await resolver.resolve4(d)).length > 0;
      } catch (e2) {
        ok = !NOT_FOUND.has((e2 as { code?: string }).code ?? "");
      }
    }
    // ETIMEOUT / ECONNREFUSED / anything else: assume OK rather than drop a real prospect.
  }
  cache.set(d, { ok, at: Date.now() });
  return ok;
}

/** Checks many domains at once (bounded concurrency) and returns a domain -> accepts-mail map. */
export async function checkDomains(
  domains: string[],
  check: (domain: string) => Promise<boolean> = domainAcceptsMail,
  concurrency = 16
): Promise<Map<string, boolean>> {
  const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, boolean>();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const domain = unique[next++];
      try {
        out.set(domain, await check(domain));
      } catch {
        out.set(domain, true);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return out;
}
