import { countryFromAddress, domainOf, isCompanySite, type Point } from "./normalize";
import type { Industry } from "./industries";

/**
 * OpenStreetMap discovery: Nominatim turns a place name into a bounding box, Overpass lists the
 * tagged businesses inside one grid cell. Both are free public services with usage policies
 * (identify yourself, roughly one request a second, no bulk hammering); the job runner spaces calls
 * out, and every call here takes an injectable `fetch` so the parsing is testable offline.
 */
export const USER_AGENT = process.env.DISCOVERY_USER_AGENT ?? "ZeroidDiscovery/1.0 (B2B research; contact via zeroid.moneyvarsity.net)";
const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org/search";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Candidate = {
  channel: "osm" | "google" | "registry";
  externalId: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
  country: string | null;
};

export type Geocoded = { label: string; box: Point; country: string | null };

export async function geocode(query: string, fetchFn: FetchLike = fetch): Promise<Geocoded | null> {
  const url = `${NOMINATIM_URL}?${new URLSearchParams({ q: query, format: "jsonv2", limit: "1", addressdetails: "0" })}`;
  const res = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Nominatim returned ${res.status}.`);
  const rows = (await res.json()) as { display_name?: string; boundingbox?: string[] }[];
  const hit = rows[0];
  if (!hit?.boundingbox || hit.boundingbox.length < 4) return null;
  // Nominatim orders the box as [south, north, west, east].
  const [south, north, west, east] = hit.boundingbox.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  return { label: query, box: { south, north, west, east }, country: countryFromAddress(hit.display_name) };
}

/** Overpass QL for one cell. Tags are validated upstream; they are still quoted-escaped here. */
export function buildOverpassQuery(industry: Industry, box: Point, limit = 300): string {
  const esc = (s: string) => s.replace(/[\\"]/g, "");
  const bbox = `${box.south.toFixed(5)},${box.west.toFixed(5)},${box.north.toFixed(5)},${box.east.toFixed(5)}`;
  const parts = industry.osm.map((t) => {
    const [k, v] = t.split("=");
    return `  nwr["${esc(k)}"="${esc(v)}"]["name"](${bbox});`;
  });
  return `[out:json][timeout:25];\n(\n${parts.join("\n")}\n);\nout center tags ${limit};`;
}

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

const first = (...vals: (string | undefined)[]) => vals.find((v) => v && v.trim())?.trim() ?? null;

export function parseOverpass(body: { elements?: OsmElement[] }, industry: Industry): Candidate[] {
  const out: Candidate[] = [];
  for (const el of body.elements ?? []) {
    const t = el.tags ?? {};
    const name = t.name?.trim();
    if (!name) continue;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const address = [street, t["addr:suburb"], t["addr:city"], t["addr:postcode"], t["addr:country"]].filter(Boolean).join(", ") || null;
    const website = first(t.website, t["contact:website"], t.url);
    const email = first(t.email, t["contact:email"])?.split(/[;,\s]+/)[0]?.toLowerCase() ?? null;
    out.push({
      channel: "osm",
      externalId: `${el.type}/${el.id}`,
      name,
      address,
      phone: first(t.phone, t["contact:phone"], t["contact:mobile"]),
      email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
      website: website && isCompanySite(domainOf(website)) ? website : null,
      category: industry.label,
      lat: el.lat ?? el.center?.lat ?? null,
      lon: el.lon ?? el.center?.lon ?? null,
      country: countryFromAddress(address) ?? t["addr:country"] ?? null,
    });
  }
  return out;
}

export class RateLimited extends Error {}

export async function searchOverpass(industry: Industry, box: Point, fetchFn: FetchLike = fetch): Promise<Candidate[]> {
  const res = await fetchFn(OVERPASS_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ data: buildOverpassQuery(industry, box) }).toString(),
    signal: AbortSignal.timeout(40_000),
  });
  if ([429, 502, 503, 504].includes(res.status)) throw new RateLimited(`Overpass is busy (${res.status}); will retry.`);
  if (!res.ok) throw new Error(`Overpass returned ${res.status}.`);
  const text = await res.text();
  let body: { elements?: OsmElement[]; remark?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new RateLimited("Overpass returned a non-JSON reply (usually overload); will retry.");
  }
  if (body.remark && /timed out|out of memory/i.test(body.remark)) throw new RateLimited(`Overpass: ${body.remark}`);
  return parseOverpass(body, industry);
}
