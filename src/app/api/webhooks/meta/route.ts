import { NextResponse } from "next/server";
import { withBusinessScope, withMetaAccountScope } from "@/lib/tenant-db";
import { ingestLead } from "@/lib/lead-intake";
import { isValidMetaSignature, parseMetaWebhook, type MetaEvent } from "@/lib/meta/webhook";
import { fetchLeadAd, fetchSenderName } from "@/lib/meta/graph";

/**
 * Facebook Page + Instagram webhook (same Meta app as the WhatsApp webhook,
 * separate callback URL because Meta configures each product's webhook
 * separately). Turns inbound DMs and comments into leads (organic) and Lead
 * Ad submissions into leads (paid).
 *
 * Deliberately capture-only: it never replies to anyone. The owner kept AI
 * autopilot beyond the WhatsApp qualification chat on hold, so a new social
 * lead gets a task for a human to answer.
 */

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (
    searchParams.get("hub.mode") === "subscribe" &&
    VERIFY_TOKEN &&
    searchParams.get("hub.verify_token") === VERIFY_TOKEN
  ) {
    return new Response(searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!isValidMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), APP_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }

  let events: MetaEvent[] = [];
  try {
    events = parseMetaWebhook(JSON.parse(rawBody));
  } catch {
    // Unparseable body from a correctly signed sender: nothing to do, still ack.
  }

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (error) {
      // Never surface a failure to Meta as non-200 (it retries the same payload repeatedly).
      console.error("Meta webhook event failed:", event.kind, error);
    }
  }
  return NextResponse.json({ ok: true });
}

async function handleEvent(event: MetaEvent) {
  const connection = await withMetaAccountScope(event.accountId, (tx) =>
    tx.metaConnection.findFirst({
      where: { OR: [{ pageId: event.accountId }, { instagramAccountId: event.accountId }] },
    })
  );
  if (!connection) return;
  const { organizationId, businessId } = connection;

  if (event.kind === "leadgen") {
    let ad;
    try {
      ad = await fetchLeadAd(event.leadgenId, connection.pageAccessToken);
    } catch (error) {
      // The submission is real but we couldn't read it -- hand it to a human
      // rather than losing a lead someone paid for.
      const message = error instanceof Error ? error.message : "Unknown error.";
      await withBusinessScope(organizationId, businessId, (tx) =>
        tx.task.create({
          data: {
            businessId,
            title: "A Facebook Lead Ad submission could not be fetched",
            note: `Lead id ${event.leadgenId}. Meta said: ${message}\nOpen it in Meta Business Suite → Leads Center.`,
          },
        })
      );
      return;
    }
    const f = ad.fields;
    const name = f.full_name || [f.first_name, f.last_name].filter(Boolean).join(" ") || null;
    await withBusinessScope(organizationId, businessId, (tx) =>
      ingestLead(tx, businessId, {
        channel: "facebook",
        medium: "paid",
        campaign: ad.campaign ?? ad.formId,
        name,
        email: f.email,
        phone: f.phone_number ?? f.phone,
        company: f.company_name,
        extra: { leadAdAnswers: f, leadAdFormId: ad.formId },
        eventType: "lead_ad_submission",
        dedupeId: `leadgen:${event.leadgenId}`,
        createReplyTask: true,
      })
    );
    return;
  }

  const platform = event.platform;
  const name =
    event.kind === "comment" && event.senderName
      ? event.senderName
      : await fetchSenderName(event.senderId, connection.pageAccessToken, platform);

  await withBusinessScope(organizationId, businessId, (tx) =>
    ingestLead(tx, businessId, {
      channel: platform,
      medium: "organic",
      name,
      socialId: event.senderId,
      message: event.text,
      eventType: event.kind === "comment" ? `${platform}_comment` : `${platform}_inbound`,
      dedupeId: `${platform}:${event.id}`,
      createReplyTask: true,
    })
  );
}
