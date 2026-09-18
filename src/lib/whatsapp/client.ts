// Direct client for the official WhatsApp Cloud API (Graph API) -- see
// build-spec.md §2 item 7: official Cloud API only, never an unofficial
// bridge. Talks straight to graph.facebook.com, not through
// ../platform-services' channels service (that turned out to be hardcoded
// to Skynett's own orchestrator for every resolve/reply -- see the
// platform-services-project memory, 2026-09-18 -- so it isn't the neutral
// multi-tenant gateway it was designed to be. Zeroid owns its own webhook
// instead, same pattern Skynett already proved works, just not shared code).

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";

export async function sendWhatsAppMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      text: { body: params.text },
    }),
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`WhatsApp send returned a non-JSON response (status ${res.status}).`);
  }
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `WhatsApp send error (status ${res.status}).`;
    throw new Error(message);
  }
  return body;
}

export type InboundMessage = {
  phoneNumberId: string;
  from: string;
  text: string;
  contactName: string | null;
  messageId: string;
};

/** Parses the (well-documented, stable) Cloud API webhook payload shape -- returns null for anything that isn't a plain inbound text message (status updates, media, etc. -- not handled in this MVP). */
export function parseInboundMessage(payload: unknown): InboundMessage | null {
  const entry = (payload as { entry?: unknown[] })?.entry?.[0] as
    | { changes?: Array<{ value?: Record<string, unknown> }> }
    | undefined;
  const value = entry?.changes?.[0]?.value;
  if (!value) return null;

  const phoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
  const messages = value.messages as Array<{ id: string; from: string; type: string; text?: { body?: string } }> | undefined;
  const message = messages?.[0];
  if (!phoneNumberId || !message || message.type !== "text" || !message.text?.body) return null;

  const contacts = value.contacts as Array<{ profile?: { name?: string } }> | undefined;
  const contactName = contacts?.[0]?.profile?.name ?? null;

  return {
    phoneNumberId,
    from: message.from,
    text: message.text.body,
    contactName,
    messageId: message.id,
  };
}
