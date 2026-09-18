import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withPhoneNumberIdScope, withBusinessScope } from "@/lib/tenant-db";
import { parseInboundMessage, sendWhatsAppMessage } from "@/lib/whatsapp/client";
import { generate, buildPrompt } from "@/lib/ai";
import { recordLeadEvent } from "@/lib/lead-events";

/**
 * Official WhatsApp Cloud API webhook (build-spec §2 item 7 / Phase 1 item
 * 9) -- talks directly to Meta, not through ../platform-services' channels
 * service. See src/lib/whatsapp/client.ts for why.
 *
 * The AI replies directly here, in real time -- this is the one feature in
 * Zeroid that's genuinely autopilot by design (owner confirmed 2026-09-18),
 * not a shortcut around the "AI Suggest, human executes" pattern everything
 * else follows: a qualifying WhatsApp bot that waits for human approval on
 * every message isn't the feature, it's a different, much weaker one.
 *
 * Deliberately NOT in scope here: auto-updating the lead's 7 scoring
 * factors from the conversation. That stays the separate, on-demand
 * /qualify action a rep triggers -- reliably extracting structured scores
 * from a live back-and-forth needs its own careful design, not a bolt-on.
 */

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Meta signs every webhook POST body with the app secret (X-Hub-Signature-256) so an
 * attacker who finds this URL can't inject fake messages -- costs real AI credits per
 * call and writes leads, so this isn't optional. https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads */
function isValidSignature(rawBody: string, header: string | null): boolean {
  if (!APP_SECRET || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!isValidSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const payload = JSON.parse(rawBody);
  const inbound = parseInboundMessage(payload);

  // Meta expects a fast 200 regardless of what we did with the payload --
  // returning non-200 makes it retry the same webhook repeatedly.
  if (!inbound) return NextResponse.json({ ok: true });

  const connection = await withPhoneNumberIdScope(inbound.phoneNumberId, (tx) =>
    tx.whatsAppConnection.findFirst({ where: { phoneNumberId: inbound.phoneNumberId } })
  );
  if (!connection) return NextResponse.json({ ok: true });

  const { organizationId, businessId } = connection;

  try {
    const result0 = await withBusinessScope(
      organizationId,
      businessId,
      async (tx) => {
        const business = await tx.business.findFirst({ where: { id: businessId } });
        if (!business) return null;

        let lead = await tx.lead.findFirst({ where: { businessId, phone: inbound.from } });
        if (!lead) {
          let source = await tx.leadSource.findFirst({ where: { businessId, channel: "whatsapp" } });
          if (!source) {
            source = await tx.leadSource.create({
              data: { businessId, channel: "whatsapp", name: "WhatsApp" },
            });
          }
          lead = await tx.lead.create({
            data: {
              businessId,
              sourceId: source.id,
              phone: inbound.from,
              name: inbound.contactName ?? undefined,
            },
          });
          await recordLeadEvent(tx, { businessId, leadId: lead.id, type: "lead_created", payload: { source: "whatsapp" } });
        }

        const history = await tx.leadEvent.findMany({
          where: { businessId, leadId: lead.id, type: { in: ["whatsapp_inbound", "whatsapp_reply"] } },
          orderBy: { createdAt: "desc" },
          take: 20,
        });

        const [products, instructions, icpProfiles] = await Promise.all([
          tx.product.findMany({ where: { businessId } }),
          tx.aiInstruction.findMany({ where: { businessId, status: "active" } }),
          tx.icpProfile.findMany({ where: { businessId, isActive: true } }),
        ]);

        await recordLeadEvent(tx, {
          businessId,
          leadId: lead.id,
          type: "whatsapp_inbound",
          payload: { text: inbound.text, messageId: inbound.messageId },
        });

        return { business, lead, products, instructions, icpProfiles, history };
      }
    );
    if (!result0) return NextResponse.json({ ok: true });
    const { business, lead, products, instructions, icpProfiles, history } = result0;

    const conversation = history
      .reverse()
      .map((e) => {
        const payload = e.payload as { text?: string };
        const speaker = e.type === "whatsapp_inbound" ? "Lead" : "You";
        return `${speaker}: ${payload.text ?? ""}`;
      })
      .join("\n");

    const prompt = buildPrompt([
      {
        label: "Task",
        content:
          "You're chatting with a lead over WhatsApp on behalf of this business, qualifying them: understand " +
          "what they need, their budget, timeline, and decision authority through natural conversation -- don't " +
          "interrogate them with a checklist. Keep replies short (this is WhatsApp, not email) and never invent " +
          "facts about the business, its products, or pricing that aren't given to you here. Respond with ONLY " +
          "the message text to send back, nothing else (no labels, no quotes).",
      },
      {
        label: "Business",
        content: `${business.name}${business.industry ? ` (${business.industry})` : ""}`,
      },
      {
        label: "Products",
        content: products
          .map((p) => `- ${p.name}${p.price != null ? ` — ${p.currency} ${p.price}` : ""}${p.description ? `: ${p.description}` : ""}`)
          .join("\n"),
      },
      {
        label: "Ideal customer profile",
        content: icpProfiles.map((p) => `- ${p.name}: ${JSON.stringify(p.attributes)}`).join("\n"),
      },
      {
        label: "Compliance rules",
        content: instructions.map((i) => `- ${i.content}`).join("\n"),
      },
      {
        label: "Conversation so far",
        content: conversation,
      },
      {
        label: "New message from the lead",
        content: inbound.text,
      },
    ]);

    const result = await generate(organizationId, businessId, "qualification_chat", {
      system: "You are a helpful, concise sales development rep chatting over WhatsApp. You never invent facts not given to you.",
      prompt,
      maxTokens: 300,
    });

    await sendWhatsAppMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: connection.accessToken,
      to: inbound.from,
      text: result.text,
    });

    await withBusinessScope(organizationId, businessId, (tx) =>
      recordLeadEvent(tx, { businessId, leadId: lead.id, type: "whatsapp_reply", payload: { text: result.text } })
    );
  } catch (error) {
    // Never let a webhook failure surface as a non-200 to Meta (causes
    // retries of the same message) -- log server-side, still ack.
    console.error("WhatsApp webhook processing failed:", error);
  }

  return NextResponse.json({ ok: true });
}
