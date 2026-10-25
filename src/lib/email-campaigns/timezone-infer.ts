import { isValidTimezone } from "./schedule";

/**
 * Best-effort timezone for a lead, so a global B2B list is emailed during the RECIPIENT working
 * hours. Order of trust: an explicit lead timezone, the country on the lead, the phone dial code,
 * then the email country-code TLD. Countries spanning several zones use the main business centre
 * (e.g. the US -> New York, Australia -> Sydney); that is a deliberate approximation.
 */

// ISO-3166 alpha-2 -> main IANA timezone
const COUNTRY_TZ: Record<string, string> = {
  NG: "Africa/Lagos", GH: "Africa/Accra", KE: "Africa/Nairobi", ZA: "Africa/Johannesburg", EG: "Africa/Cairo",
  MA: "Africa/Casablanca", TZ: "Africa/Dar_es_Salaam", UG: "Africa/Kampala", ET: "Africa/Addis_Ababa", SN: "Africa/Dakar",
  CI: "Africa/Abidjan", CM: "Africa/Douala", RW: "Africa/Kigali", ZM: "Africa/Lusaka", ZW: "Africa/Harare",
  GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin", ES: "Europe/Madrid",
  IT: "Europe/Rome", NL: "Europe/Amsterdam", BE: "Europe/Brussels", CH: "Europe/Zurich", AT: "Europe/Vienna",
  SE: "Europe/Stockholm", NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", PL: "Europe/Warsaw",
  PT: "Europe/Lisbon", GR: "Europe/Athens", TR: "Europe/Istanbul", RU: "Europe/Moscow", UA: "Europe/Kyiv",
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City", BR: "America/Sao_Paulo",
  AR: "America/Argentina/Buenos_Aires", CL: "America/Santiago", CO: "America/Bogota", PE: "America/Lima",
  AE: "Asia/Dubai", SA: "Asia/Riyadh", QA: "Asia/Qatar", IL: "Asia/Jerusalem", IN: "Asia/Kolkata", PK: "Asia/Karachi",
  BD: "Asia/Dhaka", LK: "Asia/Colombo", SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", ID: "Asia/Jakarta",
  TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh", PH: "Asia/Manila", HK: "Asia/Hong_Kong", CN: "Asia/Shanghai",
  JP: "Asia/Tokyo", KR: "Asia/Seoul", AU: "Australia/Sydney", NZ: "Pacific/Auckland",
};

// Dial code (no +) -> ISO2. Longest prefix wins; "1" is North America (ambiguous, resolved to US).
const DIAL: Record<string, string> = {
  "234": "NG", "233": "GH", "254": "KE", "27": "ZA", "20": "EG", "212": "MA", "255": "TZ", "256": "UG", "251": "ET",
  "221": "SN", "225": "CI", "237": "CM", "250": "RW", "260": "ZM", "263": "ZW",
  "44": "GB", "353": "IE", "33": "FR", "49": "DE", "34": "ES", "39": "IT", "31": "NL", "32": "BE", "41": "CH", "43": "AT",
  "46": "SE", "47": "NO", "45": "DK", "358": "FI", "48": "PL", "351": "PT", "30": "GR", "90": "TR", "7": "RU", "380": "UA",
  "1": "US", "52": "MX", "55": "BR", "54": "AR", "56": "CL", "57": "CO", "51": "PE",
  "971": "AE", "966": "SA", "974": "QA", "972": "IL", "91": "IN", "92": "PK", "880": "BD", "94": "LK", "65": "SG",
  "60": "MY", "62": "ID", "66": "TH", "84": "VN", "63": "PH", "852": "HK", "86": "CN", "81": "JP", "82": "KR", "61": "AU", "64": "NZ",
};

const NAME_TO_ISO: Record<string, string> = {
  nigeria: "NG", ghana: "GH", kenya: "KE", "south africa": "ZA", egypt: "EG", morocco: "MA", tanzania: "TZ", uganda: "UG",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", ireland: "IE", france: "FR",
  germany: "DE", spain: "ES", italy: "IT", netherlands: "NL", belgium: "BE", switzerland: "CH", austria: "AT", sweden: "SE",
  norway: "NO", denmark: "DK", finland: "FI", poland: "PL", portugal: "PT", greece: "GR", turkey: "TR", russia: "RU", ukraine: "UA",
  "united states": "US", usa: "US", "united states of america": "US", america: "US", canada: "CA", mexico: "MX", brazil: "BR",
  argentina: "AR", chile: "CL", colombia: "CO", peru: "PE", "united arab emirates": "AE", uae: "AE", dubai: "AE",
  "saudi arabia": "SA", qatar: "QA", israel: "IL", india: "IN", pakistan: "PK", bangladesh: "BD", "sri lanka": "LK",
  singapore: "SG", malaysia: "MY", indonesia: "ID", thailand: "TH", vietnam: "VN", philippines: "PH", "hong kong": "HK",
  china: "CN", japan: "JP", "south korea": "KR", korea: "KR", australia: "AU", "new zealand": "NZ",
};

// Email country-code TLDs that differ from the ISO code.
const TLD_ALIAS: Record<string, string> = { uk: "GB" };

const tzOf = (iso: string | undefined) => (iso ? COUNTRY_TZ[iso] : undefined);

function fromCountryText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  if (/^[a-z]{2}$/.test(t)) return tzOf(TLD_ALIAS[t] ?? t.toUpperCase());
  return tzOf(NAME_TO_ISO[t]);
}

function fromPhone(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits.startsWith("+") && !digits.startsWith("00")) return undefined; // need an international prefix
  const n = digits.replace(/^\+|^00/, "");
  for (const len of [3, 2, 1]) {
    const iso = DIAL[n.slice(0, len)];
    if (iso) return tzOf(iso);
  }
  return undefined;
}

function fromEmail(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const tld = raw.trim().toLowerCase().split("@")[1]?.split(".").pop();
  if (!tld || tld.length !== 2) return undefined;
  return tzOf(TLD_ALIAS[tld] ?? tld.toUpperCase());
}

export function inferTimezone(lead: { contact?: unknown; phone?: string | null; email?: string | null }): string | null {
  const contact = (lead.contact ?? {}) as Record<string, unknown>;
  const explicit = contact.timezone;
  if (typeof explicit === "string" && isValidTimezone(explicit)) return explicit;
  return fromCountryText(contact.country) ?? fromPhone(lead.phone) ?? fromEmail(lead.email) ?? null;
}
