import { createPublicKey } from "node:crypto";
import { promises as dns } from "node:dns";

/**
 * Checks the DNS records that decide whether mail from a sending domain reaches the inbox:
 * SPF, DKIM (and that the published key matches the private key we sign with), DMARC and MX.
 * The resolver is injectable so the logic is testable without the network.
 */
export type Resolver = { resolveTxt(name: string): Promise<string[][]>; resolveMx(name: string): Promise<{ exchange: string }[]> };
export type CheckStatus = "pass" | "warn" | "fail";
export type Check = { name: "SPF" | "DKIM" | "DMARC" | "MX"; status: CheckStatus; detail: string };

const txt = async (r: Resolver, name: string): Promise<string[] | null> => {
  try {
    return (await r.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    return null; // resolver problem: unknown, not "missing"
  }
};

const unknown = (name: Check["name"]): Check => ({ name, status: "warn", detail: "Could not reach DNS to check this just now. Try again." });

/** SPF: must exist, be a single record, and should end in -all or ~all. */
export function evaluateSpf(records: string[], expectInclude?: string): Check {
  const spf = records.filter((r) => /^v=spf1\b/i.test(r));
  if (spf.length === 0) return { name: "SPF", status: "fail", detail: "No SPF record. Add a TXT record such as: v=spf1 mx ~all (plus your sending server or relay)." };
  if (spf.length > 1) return { name: "SPF", status: "fail", detail: "More than one SPF record. Receivers reject this; merge them into one." };
  const rec = spf[0];
  if (/\s\+all\b/i.test(rec)) return { name: "SPF", status: "fail", detail: "SPF ends in +all, which lets anyone send as you." };
  if (expectInclude && !rec.toLowerCase().includes(expectInclude.toLowerCase())) {
    return { name: "SPF", status: "warn", detail: `SPF exists but does not mention ${expectInclude}, so mail relayed through it may fail SPF.` };
  }
  if (/[-~]all\b/i.test(rec)) return { name: "SPF", status: "pass", detail: "SPF is present and ends in a restrictive policy." };
  return { name: "SPF", status: "warn", detail: "SPF is present but has no -all or ~all ending. Add ~all (or -all once stable)." };
}

/** The p= value of a DKIM record, whitespace removed. */
const dkimKey = (record: string) => (record.match(/\bp=([A-Za-z0-9+/=\s]*)/)?.[1] ?? "").replace(/\s+/g, "");

/** Derives the public key (base64 SPKI, as published in DNS) from our private PEM. */
export function publicKeyFromPrivatePem(pem: string): string | null {
  try {
    return createPublicKey(pem).export({ type: "spki", format: "der" }).toString("base64");
  } catch {
    return null;
  }
}

export function evaluateDkim(records: string[], privatePem?: string | null): Check {
  const rec = records.find((r) => /\bv=DKIM1\b/i.test(r) || /\bp=/.test(r));
  if (!rec) return { name: "DKIM", status: "fail", detail: "No DKIM record at that selector. Publish the public key as a TXT record." };
  const published = dkimKey(rec);
  if (!published) return { name: "DKIM", status: "fail", detail: "The DKIM record has an empty key (p=), which means it was revoked." };
  if (privatePem) {
    const mine = publicKeyFromPrivatePem(privatePem);
    if (!mine) return { name: "DKIM", status: "warn", detail: "A DKIM record exists, but the private key saved here could not be read as a PEM key." };
    if (mine !== published) return { name: "DKIM", status: "fail", detail: "The published DKIM key does NOT match the private key Zeroid signs with. Mail will fail DKIM." };
    return { name: "DKIM", status: "pass", detail: "DKIM is published and matches the signing key." };
  }
  return { name: "DKIM", status: "warn", detail: "A DKIM record exists, but no private key is saved here to compare it with." };
}

export function evaluateDmarc(records: string[]): Check {
  const rec = records.find((r) => /^v=DMARC1\b/i.test(r));
  if (!rec) return { name: "DMARC", status: "fail", detail: "No DMARC record at _dmarc. Add: v=DMARC1; p=none; rua=mailto:you@yourdomain (tighten to quarantine later)." };
  const policy = rec.match(/\bp=(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();
  if (!policy) return { name: "DMARC", status: "warn", detail: "DMARC exists but has no valid p= policy." };
  if (policy === "none") return { name: "DMARC", status: "warn", detail: "DMARC is in monitor-only mode (p=none). Fine to start; move to quarantine once mail is authenticating." };
  return { name: "DMARC", status: "pass", detail: `DMARC policy is ${policy}.` };
}

export async function checkDomainHealth(
  domain: string,
  opts: { selector?: string | null; privateKeyPem?: string | null; spfInclude?: string; resolver?: Resolver } = {}
): Promise<Check[]> {
  const r: Resolver = opts.resolver ?? dns;
  const d = domain.trim().toLowerCase();
  const checks: Check[] = [];

  const spf = await txt(r, d);
  checks.push(spf ? evaluateSpf(spf, opts.spfInclude) : unknown("SPF"));

  if (opts.selector) {
    const dk = await txt(r, `${opts.selector}._domainkey.${d}`);
    checks.push(dk ? evaluateDkim(dk, opts.privateKeyPem) : unknown("DKIM"));
  } else {
    checks.push({ name: "DKIM", status: "warn", detail: "No DKIM selector is set on this identity, so mail is not DKIM-signed by Zeroid." });
  }

  const dmarc = await txt(r, `_dmarc.${d}`);
  checks.push(dmarc ? evaluateDmarc(dmarc) : unknown("DMARC"));

  try {
    const mx = await r.resolveMx(d);
    checks.push(
      mx.length
        ? { name: "MX", status: "pass", detail: "The domain can receive replies and bounces." }
        : { name: "MX", status: "fail", detail: "No MX record, so replies and bounce messages to this domain will not arrive." }
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    checks.push(code === "ENOTFOUND" || code === "ENODATA" ? { name: "MX", status: "fail", detail: "No MX record, so replies and bounce messages to this domain will not arrive." } : unknown("MX"));
  }
  return checks;
}
