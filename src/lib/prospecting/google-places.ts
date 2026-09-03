// Client for the Places API (New) Text Search endpoint.
// https://developers.google.com/maps/documentation/places/web-service/text-search
//
// NOT live-tested against a real key yet -- built carefully against Google's
// documented request/response shape, but flag this the first time a real
// GOOGLE_PLACES_API_KEY exists: confirm the response fields actually match
// before relying on this for real prospecting data (same discipline as the
// Vapi/Flutterwave integrations elsewhere in this codebase).

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export function isGooglePlacesConfigured() {
  return Boolean(API_KEY);
}

export type PlaceResult = {
  externalId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
};

type PlacesSearchResponse = {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    primaryTypeDisplayName?: { text?: string };
  }>;
  error?: { message?: string };
};

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  if (!API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set -- prospecting via Google Places is unavailable.");
  }

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.primaryTypeDisplayName",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query }),
  });

  const text = await res.text();
  let body: PlacesSearchResponse | null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Google Places returned a non-JSON response (status ${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Google Places error (status ${res.status}).`);
  }

  return (body?.places ?? []).map((p) => ({
    externalId: p.id,
    name: p.displayName?.text ?? "Unknown business",
    address: p.formattedAddress ?? null,
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    category: p.primaryTypeDisplayName?.text ?? null,
  }));
}
