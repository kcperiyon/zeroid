import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta signs every webhook POST (X-Hub-Signature-256) with the app secret. */
export function isValidMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");
  const provided = Buffer.from(header.slice("sha256=".length), "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export type MetaPlatform = "facebook" | "instagram";

export type MetaEvent =
  | { kind: "message"; platform: MetaPlatform; accountId: string; senderId: string; text: string; id: string }
  | {
      kind: "comment";
      platform: MetaPlatform;
      accountId: string;
      senderId: string;
      senderName: string | null;
      text: string;
      id: string;
    }
  | { kind: "leadgen"; accountId: string; leadgenId: string };

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);
const asStr = (v: unknown): string | null =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Flattens Meta's page / instagram webhook payloads into the few event shapes
 * Zeroid acts on. Anything else -- echoes of our own sends, reactions, the
 * Page's own comments, unsupported fields -- is dropped here so the handler
 * never has to second-guess it.
 */
export function parseMetaWebhook(payload: unknown): MetaEvent[] {
  const root = asObj(payload);
  if (!root) return [];
  const platform: MetaPlatform | null =
    root.object === "page" ? "facebook" : root.object === "instagram" ? "instagram" : null;
  if (!platform) return [];

  const events: MetaEvent[] = [];
  for (const rawEntry of asArr(root.entry)) {
    const entry = asObj(rawEntry);
    const accountId = asStr(entry?.id);
    if (!entry || !accountId) continue;

    for (const rawMsg of asArr(entry.messaging)) {
      const m = asObj(rawMsg);
      const message = asObj(m?.message);
      const senderId = asStr(asObj(m?.sender)?.id);
      if (!m || !message || !senderId || message.is_echo === true || senderId === accountId) continue;
      const id = asStr(message.mid);
      if (!id) continue;
      const text = asStr(message.text) ?? (asArr(message.attachments).length ? "[attachment]" : null);
      if (text) events.push({ kind: "message", platform, accountId, senderId, text, id });
    }

    for (const rawChange of asArr(entry.changes)) {
      const change = asObj(rawChange);
      const value = asObj(change?.value);
      if (!change || !value) continue;

      if (platform === "facebook" && change.field === "feed") {
        const from = asObj(value.from);
        const senderId = asStr(from?.id);
        const id = asStr(value.comment_id);
        const text = asStr(value.message);
        if (value.item === "comment" && value.verb === "add" && senderId && senderId !== accountId && id && text) {
          events.push({ kind: "comment", platform, accountId, senderId, senderName: asStr(from?.name), text, id });
        }
      } else if (platform === "facebook" && change.field === "leadgen") {
        const leadgenId = asStr(value.leadgen_id);
        const pageId = asStr(value.page_id) ?? accountId;
        if (leadgenId) events.push({ kind: "leadgen", accountId: pageId, leadgenId });
      } else if (platform === "instagram" && change.field === "comments") {
        const from = asObj(value.from);
        const senderId = asStr(from?.id);
        const id = asStr(value.id);
        const text = asStr(value.text);
        if (senderId && senderId !== accountId && id && text) {
          events.push({ kind: "comment", platform, accountId, senderId, senderName: asStr(from?.username), text, id });
        }
      }
    }
  }
  return events;
}
