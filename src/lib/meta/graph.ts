// Thin client for the parts of Meta's Graph API Zeroid uses for Facebook Pages
// and Instagram: verifying a Page token, subscribing the Page to our webhook,
// fetching Lead Ad submissions, and Instagram Business Discovery.
// Written against the documented contract; every failure is surfaced with
// Meta's own message rather than swallowed.
// https://developers.facebook.com/docs/graph-api  /  /docs/instagram-platform

const VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

type GraphError = { error?: { message?: string; code?: number } };

async function graph<T>(
  method: "GET" | "POST",
  path: string,
  token: string,
  params: Record<string, string> = {}
): Promise<T> {
  const search = new URLSearchParams({ ...params, access_token: token });
  const url = method === "GET" ? `${BASE}/${path}?${search}` : `${BASE}/${path}`;
  const res = await fetch(url, {
    method,
    ...(method === "POST"
      ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: search.toString() }
      : {}),
  });
  const text = await res.text();
  let body: (T & GraphError) | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Meta returned a non-JSON response (status ${res.status}).`);
  }
  if (!res.ok || body?.error) {
    throw new Error(body?.error?.message ?? `Meta Graph API error (status ${res.status}).`);
  }
  return body as T;
}

export type PageInfo = { name: string | null; instagramAccountId: string | null; instagramUsername: string | null };

/** Confirms the token works for this Page and discovers its linked Instagram professional account. */
export async function verifyPage(pageId: string, token: string): Promise<PageInfo> {
  const r = await graph<{
    name?: string;
    instagram_business_account?: { id: string; username?: string };
  }>("GET", pageId, token, { fields: "name,instagram_business_account{id,username}" });
  return {
    name: r.name ?? null,
    instagramAccountId: r.instagram_business_account?.id ?? null,
    instagramUsername: r.instagram_business_account?.username ?? null,
  };
}

/** Subscribes the Page to this app's webhook for DMs, comments/posts and lead ads. */
export async function subscribePage(pageId: string, token: string): Promise<void> {
  await graph("POST", `${pageId}/subscribed_apps`, token, {
    subscribed_fields: "messages,feed,leadgen",
  });
}

export type LeadAd = {
  fields: Record<string, string>;
  campaign: string | null;
  formId: string | null;
};

/** Fetches a Lead Ad submission. Meta's webhook only sends the leadgen id, never the answers. */
export async function fetchLeadAd(leadgenId: string, token: string): Promise<LeadAd> {
  const r = await graph<{
    field_data?: Array<{ name: string; values?: string[] }>;
    campaign_name?: string;
    ad_name?: string;
    form_id?: string;
  }>("GET", leadgenId, token, { fields: "field_data,campaign_name,ad_name,form_id" });
  const fields: Record<string, string> = {};
  for (const f of r.field_data ?? []) fields[f.name] = (f.values ?? []).join(", ");
  return { fields, campaign: r.campaign_name ?? r.ad_name ?? null, formId: r.form_id ?? null };
}

/** Best-effort display name for a Messenger / Instagram sender; never throws. */
export async function fetchSenderName(
  senderId: string,
  token: string,
  platform: "facebook" | "instagram"
): Promise<string | null> {
  try {
    const r = await graph<{ name?: string; username?: string }>("GET", senderId, token, {
      fields: platform === "instagram" ? "name,username" : "name",
    });
    return r.name ?? r.username ?? null;
  } catch {
    return null;
  }
}

export type DiscoveredAccount = {
  id: string;
  username: string;
  name: string | null;
  biography: string | null;
  website: string | null;
  followers: number | null;
};

/**
 * Instagram Business Discovery: public profile data for another Instagram
 * business/creator account, looked up by username. It is a lookup, not a
 * search -- you must already know the username -- and only works for
 * professional accounts.
 */
export async function discoverInstagramAccount(
  ownInstagramId: string,
  token: string,
  username: string
): Promise<DiscoveredAccount> {
  const r = await graph<{
    business_discovery?: {
      id: string;
      username: string;
      name?: string;
      biography?: string;
      website?: string;
      followers_count?: number;
    };
  }>("GET", ownInstagramId, token, {
    fields: `business_discovery.username(${username}){id,username,name,biography,website,followers_count}`,
  });
  const d = r.business_discovery;
  if (!d) throw new Error("No data returned (the account may not be a business or creator account).");
  return {
    id: d.id,
    username: d.username,
    name: d.name ?? null,
    biography: d.biography ?? null,
    website: d.website ?? null,
    followers: d.followers_count ?? null,
  };
}
