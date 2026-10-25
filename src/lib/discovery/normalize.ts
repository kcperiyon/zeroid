/** Small, dependency-free helpers shared by discovery, enrichment and de-duplication. */

/** Hostname of a website value ("Example.com/path", "https://www.example.com"), without "www.". */
export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = website.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    // A real hostname: dotted labels whose last label has a letter (so bare IP addresses are not "domains").
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && /[a-z]/.test(host.split(".").pop()!) ? host : null;
  } catch {
    return null;
  }
}

/** Social networks and directories whose "website" is not the company's own site. */
const NOT_A_COMPANY_SITE = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "youtube.com", "wa.me",
  "linktr.ee", "business.site", "google.com", "goo.gl", "maps.app.goo.gl", "yelp.com", "tripadvisor.com",
]);
export const isCompanySite = (domain: string | null) =>
  !!domain && ![...NOT_A_COMPANY_SITE].some((d) => domain === d || domain.endsWith(`.${d}`));

/** Digits only, so "+234 (707) 296-3805" and "07072963805" can be compared by their last 9 digits. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(ltd|limited|llc|inc|plc|gmbh|co|company|corp|corporation|sa|srl|pty|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Point = { south: number; west: number; north: number; east: number };

/**
 * Splits a bounding box into roughly `cellDeg` x `cellDeg` squares (0.1 degree is about 11 km).
 * Refuses to produce more than `maxCells`; the caller should say "pick a smaller area" rather than
 * silently searching a thinned-out grid.
 */
export function gridCells(box: Point, cellDeg = 0.1, maxCells = 100): Point[] | null {
  if (!(box.north > box.south) || !(box.east > box.west)) return null;
  // The epsilon stops 0.2 / 0.1 = 2.0000000000000004 from becoming three rows.
  const rows = Math.max(1, Math.ceil((box.north - box.south) / cellDeg - 1e-9));
  const cols = Math.max(1, Math.ceil((box.east - box.west) / cellDeg - 1e-9));
  if (rows * cols > maxCells) return null;
  const h = (box.north - box.south) / rows;
  const w = (box.east - box.west) / cols;
  const cells: Point[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ south: box.south + r * h, north: box.south + (r + 1) * h, west: box.west + c * w, east: box.west + (c + 1) * w });
    }
  }
  return cells;
}

/** Best-effort country from the end of an address ("... , Lagos, Nigeria"). */
export function countryFromAddress(address: string | null | undefined): string | null {
  const last = (address ?? "").split(",").pop()?.trim();
  return last && last.length >= 3 && last.length <= 40 && !/\d/.test(last) ? last : null;
}
