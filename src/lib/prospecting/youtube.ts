// Client for the YouTube Data API v3 -- search.list (find channels matching
// a query) + channels.list (get each channel's full "About" description,
// which often has a published contact email). Both are documented, stable,
// key-only (no OAuth) endpoints.
// https://developers.google.com/youtube/v3/docs/search/list
// https://developers.google.com/youtube/v3/docs/channels/list
//
// NOT live-tested against a real key yet -- same discipline as the Places
// client: confirm the response fields actually match the first time a real
// YOUTUBE_API_KEY exists, before relying on this for real prospecting data.

const API_KEY = process.env.YOUTUBE_API_KEY;

export function isYoutubeConfigured() {
  return Boolean(API_KEY);
}

export type YoutubeResult = {
  externalId: string;
  name: string;
  website: string;
  email: string | null;
  category: string | null;
};

type SearchResponse = {
  items?: Array<{ id?: { channelId?: string } }>;
  error?: { message?: string };
};

type ChannelsResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; description?: string; customUrl?: string; country?: string };
  }>;
  error?: { message?: string };
};

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;

async function callYoutube<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!API_KEY) {
    throw new Error("YOUTUBE_API_KEY is not set -- prospecting via YouTube is unavailable.");
  }
  const query = new URLSearchParams({ ...params, key: API_KEY }).toString();
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`);

  const text = await res.text();
  let body: (T & { error?: { message?: string } }) | null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`YouTube API returned a non-JSON response (status ${res.status}).`);
  }
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `YouTube API error (status ${res.status}).`);
  }
  return body as T;
}

export async function searchYoutubeChannels(query: string, limit = 10): Promise<YoutubeResult[]> {
  const search = await callYoutube<SearchResponse>("search", {
    part: "snippet",
    type: "channel",
    q: query,
    maxResults: String(limit),
  });

  const channelIds = (search.items ?? [])
    .map((item) => item.id?.channelId)
    .filter((id): id is string => Boolean(id));
  if (channelIds.length === 0) return [];

  const channels = await callYoutube<ChannelsResponse>("channels", {
    part: "snippet",
    id: channelIds.join(","),
  });

  return (channels.items ?? []).map((c) => {
    const description = c.snippet?.description ?? "";
    const email = description.match(EMAIL_PATTERN)?.[0] ?? null;
    const handle = c.snippet?.customUrl;
    return {
      externalId: c.id,
      name: c.snippet?.title ?? "Unknown channel",
      website: handle ? `https://youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}` : `https://youtube.com/channel/${c.id}`,
      email,
      category: c.snippet?.country ?? null,
    };
  });
}
