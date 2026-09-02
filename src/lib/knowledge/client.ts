// Client for platform-services' knowledge/RAG service (../platform-services,
// pulled from Skynett — see build-spec.md §8). Reached through an
// authenticated nginx path, NOT the raw Docker host port: the service has
// no auth of its own and its host port is now bound to 127.0.0.1 only on
// the VPS, so this shared-secret header is the only way in from outside.
//
// Zeroid's own Business.id (a cuid) is passed directly as business_id —
// Skynett's business ids are UUIDs, a different format, so there's no
// collision risk and no separate tenant-mapping column is needed.

const BASE_URL = process.env.PLATFORM_KNOWLEDGE_BASE_URL ?? "https://wa.lagosbusinessgroup.com/platform/knowledge";
const API_KEY = process.env.PLATFORM_KNOWLEDGE_API_KEY;

function requireConfig() {
  if (!API_KEY) {
    throw new Error("PLATFORM_KNOWLEDGE_API_KEY is not set — Train Your AI is unavailable.");
  }
}

async function call(path: string, init: RequestInit) {
  requireConfig();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Platform-Key": API_KEY!,
      ...init.headers,
    },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // The knowledge service is unreachable/misconfigured and something in
    // front of it (nginx, Cloudflare) returned HTML instead of JSON.
    throw new Error(`Knowledge service returned a non-JSON response (status ${res.status}).`);
  }

  if (!res.ok) {
    const message = (body as { detail?: string; error?: string } | null)?.detail
      ?? (body as { detail?: string; error?: string } | null)?.error
      ?? `Knowledge service error (status ${res.status}).`;
    throw new Error(message);
  }

  return body;
}

export async function ingestText(params: {
  sourceId: string;
  sourceName: string;
  text: string;
  businessId: string;
}) {
  await call("/ingest-text", {
    method: "POST",
    body: JSON.stringify({
      source_id: params.sourceId,
      source_name: params.sourceName,
      text: params.text,
      business_id: params.businessId,
    }),
  });
}

export async function ingestUrl(params: {
  sourceId: string;
  url: string;
  name: string;
  businessId: string;
}) {
  await call("/ingest-url", {
    method: "POST",
    body: JSON.stringify({
      source_id: params.sourceId,
      url: params.url,
      name: params.name,
      business_id: params.businessId,
    }),
  });
}

export async function deleteSource(sourceId: string) {
  await call(`/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
}

export type KnowledgeChunk = { content: string; source: string; score: number };

export async function retrieve(params: { query: string; businessId: string; topK?: number }): Promise<KnowledgeChunk[]> {
  const body = (await call("/retrieve", {
    method: "POST",
    body: JSON.stringify({
      query: params.query,
      business_id: params.businessId,
      top_k: params.topK ?? 5,
    }),
  })) as { results?: KnowledgeChunk[] };
  return body.results ?? [];
}

export function isKnowledgeServiceConfigured() {
  return Boolean(API_KEY);
}
