/**
 * The B2B industries discovery can search, each mapped to OpenStreetMap tags (free, global) and a
 * plain-language query for Google Places. Custom OSM tags are accepted too, but only in a strict
 * key=value shape, because the value ends up inside an Overpass query.
 */
export type Industry = { key: string; label: string; osm: string[]; query: string };

export const INDUSTRIES: Industry[] = [
  { key: "accountants", label: "Accountants and tax advisers", osm: ["office=accountant", "office=tax_advisor"], query: "accounting firm" },
  { key: "lawyers", label: "Law firms", osm: ["office=lawyer", "office=notary"], query: "law firm" },
  { key: "real_estate", label: "Real estate agents", osm: ["office=estate_agent"], query: "real estate agency" },
  { key: "insurance", label: "Insurance agents", osm: ["office=insurance"], query: "insurance agency" },
  { key: "financial", label: "Financial advisers and lenders", osm: ["office=financial", "office=financial_advisor"], query: "financial advisory" },
  { key: "it_services", label: "IT and software companies", osm: ["office=it", "office=software"], query: "IT services company" },
  { key: "marketing", label: "Marketing and advertising agencies", osm: ["office=advertising_agency", "office=marketing"], query: "marketing agency" },
  { key: "consulting", label: "Consultancies", osm: ["office=consulting", "office=company"], query: "business consultant" },
  { key: "architects", label: "Architects and engineers", osm: ["office=architect", "office=engineer"], query: "architecture firm" },
  { key: "construction", label: "Construction companies", osm: ["office=construction_company", "craft=builder"], query: "construction company" },
  { key: "electrical", label: "Electricians", osm: ["craft=electrician"], query: "electrician" },
  { key: "plumbing", label: "Plumbers and HVAC", osm: ["craft=plumber", "craft=hvac"], query: "plumber" },
  { key: "logistics", label: "Logistics and freight", osm: ["office=logistics", "office=freight_forwarder", "industrial=logistics"], query: "logistics company" },
  { key: "manufacturing", label: "Manufacturers", osm: ["industrial=factory", "craft=manufacturer"], query: "manufacturer" },
  { key: "wholesale", label: "Wholesalers and distributors", osm: ["shop=wholesale", "office=distributor"], query: "wholesale distributor" },
  { key: "agriculture", label: "Agribusiness", osm: ["office=agricultural", "industrial=agriculture"], query: "agribusiness" },
  { key: "energy", label: "Energy and solar installers", osm: ["craft=solar_panel_installer", "office=energy_supplier"], query: "solar installer" },
  { key: "recruitment", label: "Recruitment and staffing", osm: ["office=employment_agency"], query: "recruitment agency" },
  { key: "education", label: "Private schools and training centres", osm: ["amenity=school", "amenity=training", "amenity=language_school"], query: "training centre" },
  { key: "clinics", label: "Clinics and dentists", osm: ["amenity=clinic", "amenity=dentist", "healthcare=clinic"], query: "private clinic" },
  { key: "pharmacies", label: "Pharmacies", osm: ["amenity=pharmacy"], query: "pharmacy" },
  { key: "hotels", label: "Hotels and guest houses", osm: ["tourism=hotel", "tourism=guest_house"], query: "hotel" },
  { key: "restaurants", label: "Restaurants and caterers", osm: ["amenity=restaurant", "craft=caterer"], query: "restaurant" },
  { key: "car_dealers", label: "Car dealers and garages", osm: ["shop=car", "shop=car_repair"], query: "car dealership" },
  { key: "printing", label: "Printers and signage", osm: ["craft=printer", "shop=copyshop"], query: "printing company" },
  { key: "travel", label: "Travel agencies", osm: ["shop=travel_agency", "office=travel_agent"], query: "travel agency" },
  { key: "security", label: "Security companies", osm: ["office=security"], query: "security company" },
  { key: "ngos", label: "NGOs and associations", osm: ["office=ngo", "office=association"], query: "non-profit organisation" },
];

const BY_KEY = new Map(INDUSTRIES.map((i) => [i.key, i]));

/** key=value, lowercase letters, digits, underscore and colon only. Anything else is rejected. */
const CUSTOM_TAG = /^[a-z_:]{1,30}=[a-z0-9_:]{1,40}$/;
export const isCustomOsmTag = (s: string) => CUSTOM_TAG.test(s);

/** Accepts a catalog key or `osm:key=value`. Returns null for anything else. */
export function resolveIndustry(input: string): Industry | null {
  const known = BY_KEY.get(input);
  if (known) return known;
  if (input.startsWith("osm:")) {
    const tag = input.slice(4);
    if (isCustomOsmTag(tag)) return { key: input, label: `OSM ${tag}`, osm: [tag], query: tag.split("=")[1].replace(/_/g, " ") };
  }
  return null;
}
