import { promises as dns } from "node:dns";

/**
 * Free deliverability pre-check: does the recipient domain accept mail at all (MX record, or an A
 * record as the SMTP fallback)? Sending to a dead domain only produces a bounce, which hurts
 * sender reputation. Cached per process; DNS errors other than "does not exist" count as OK so a
 * flaky resolver never silently drops real prospects.
 */
const cache = new Map<string, { ok: boolean; at: number }>();
const TTL_MS = 6 * 60 * 60_000;

export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const d = domain.trim().toLowerCase();
  const hit = cache.get(d);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;

  let ok = true;
  try {
    const mx = await dns.resolveMx(d);
    ok = mx.length > 0;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      try {
        ok = (await dns.resolve4(d)).length > 0;
      } catch (e2) {
        const c2 = (e2 as { code?: string }).code;
        ok = !(c2 === "ENOTFOUND" || c2 === "ENODATA");
      }
    }
  }
  cache.set(d, { ok, at: Date.now() });
  return ok;
}
