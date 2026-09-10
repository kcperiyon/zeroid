// Client for Etsy's Open API v3 -- listings/active (search by keyword) +
// shops/{shop_id} (get the seller's shop info). Both are public, key-only
// endpoints (no OAuth needed for reading public data).
// https://developer.etsy.com/documentation/reference/#operation/findAllActiveListings
// https://developer.etsy.com/documentation/reference/#operation/getShop
//
// Real limitation, not a bug: Etsy does not expose a seller's email or
// phone through this API -- all buyer-seller contact happens inside Etsy's
// own messaging. Results here are a shop name + Etsy shop URL only; there's
// no direct contact method to pull.
//
// NOT live-tested against a real key yet -- same discipline as the Places
// and YouTube clients: confirm the response fields actually match the
// first time a real ETSY_API_KEY exists.

const API_KEY = process.env.ETSY_API_KEY;

export function isEtsyConfigured() {
  return Boolean(API_KEY);
}

export type EtsyResult = {
  externalId: string;
  name: string;
  website: string;
  category: string | null;
};

type ListingsResponse = {
  results?: Array<{ shop_id?: number; title?: string }>;
  error?: string;
};

type ShopResponse = {
  shop_id: number;
  shop_name: string;
  url?: string;
};

async function callEtsy<T>(path: string): Promise<T> {
  if (!API_KEY) {
    throw new Error("ETSY_API_KEY is not set -- prospecting via Etsy is unavailable.");
  }
  const res = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    headers: { "x-api-key": API_KEY },
  });

  const text = await res.text();
  let body: (T & { error?: string }) | null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Etsy API returned a non-JSON response (status ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(body?.error ?? `Etsy API error (status ${res.status}).`);
  }
  return body as T;
}

export async function searchEtsyShops(query: string, limit = 10): Promise<EtsyResult[]> {
  const listings = await callEtsy<ListingsResponse>(
    `/listings/active?keywords=${encodeURIComponent(query)}&limit=${limit}`
  );

  const shopIds = [...new Set((listings.results ?? []).map((l) => l.shop_id).filter((id): id is number => Boolean(id)))];
  if (shopIds.length === 0) return [];

  const shops = await Promise.all(
    shopIds.slice(0, limit).map(async (shopId) => {
      try {
        return await callEtsy<ShopResponse>(`/shops/${shopId}`);
      } catch {
        return null;
      }
    })
  );

  return shops
    .filter((s): s is ShopResponse => s !== null)
    .map((shop) => ({
      externalId: String(shop.shop_id),
      name: shop.shop_name,
      website: shop.url ?? `https://www.etsy.com/shop/${shop.shop_name}`,
      category: "Etsy seller",
    }));
}
