import { simpleParser, type ParsedMail } from "mailparser";
import { withBusinessOnlyScope, withMessageLookupScope } from "@/lib/tenant-db";
import { recordLeadEvent } from "@/lib/lead-events";
import { recordEmailEvent } from "./engine";
import { classifyReply, stripQuoted, type ReplyClass } from "./classify";
import { addSuppression } from "./suppression";
import { cancelPendingForEmail } from "./unsubscribe";

/**
 * Inbound mail from our own MTA (or any relay that forwards raw messages here): bounces (DSNs),
 * spam complaints (ARF) and replies. The message is matched back to the campaign email it answers
 * by the Message-ID we sent with (In-Reply-To / References), by the X-Zeroid-Message header our
 * emails carry (bounces quote it), or by the +token in the reply address.
 */

export type InboundResult =
  | { kind: "unmatched" }
  | { kind: "bounce"; hard: boolean }
  | { kind: "complaint" }
  | { kind: "reply"; cls: ReplyClass; via: string };

const TOKEN_RE = /X-Zeroid-Message:\s*([A-Za-z0-9_-]{16,})/i;
const PLUS_RE = /\+([A-Za-z0-9_-]{16,})@/;
const MSGID_RE = /<([^<>\s]+@[^<>\s]+)>/g;

function headerText(parsed: ParsedMail, name: string): string {
  const v = parsed.headers.get(name);
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(" ");
  return "text" in (v as object) ? String((v as { text: string }).text) : String(v);
}

export function detectKind(parsed: ParsedMail, rawText: string): "bounce" | "complaint" | "reply" {
  // mailparser returns content-type as a structured object, so read the raw top-level headers.
  const ctype = rawText.slice(0, 8000).toLowerCase();
  const from = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
  if (ctype.includes("report-type=feedback-report") || /feedback-type:\s*abuse/i.test(rawText)) return "complaint";
  if (
    ctype.includes("report-type=delivery-status") ||
    /^(mailer-daemon|postmaster)@/.test(from) ||
    /^(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|failure)|returned mail|failure notice)/i.test(parsed.subject ?? "")
  ) {
    return "bounce";
  }
  return "reply";
}

/** 5.x.x = permanent (hard); 4.x.x = temporary (soft). Falls back to wording when no status code is present. */
export function isHardBounce(rawText: string): boolean {
  const status = rawText.match(/Status:\s*([245])\.\d+\.\d+/i);
  if (status) return status[1] === "5";
  return /(user unknown|no such user|mailbox (not found|unavailable)|does not exist|address rejected|recipient rejected|unknown recipient)/i.test(rawText);
}

function isAutoReply(parsed: ParsedMail): boolean {
  const auto = headerText(parsed, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return true;
  if (headerText(parsed, "x-autoreply") || headerText(parsed, "x-autorespond")) return true;
  if (/^(auto_reply|auto-reply|bulk|junk)$/i.test(headerText(parsed, "precedence").trim())) return true;
  return /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office)/i.test(parsed.subject ?? "");
}

async function resolveMessage(parsed: ParsedMail, rawText: string) {
  const find = (lookup: { token?: string; messageId?: string }) =>
    withMessageLookupScope(lookup, (tx) =>
      tx.campaignMessage.findFirst({
        where: lookup.token ? { token: lookup.token } : { messageId: lookup.messageId },
        select: { id: true, businessId: true, campaignId: true, leadId: true, toEmail: true, token: true },
      })
    );

  const ids = new Set<string>();
  for (const h of [headerText(parsed, "in-reply-to"), headerText(parsed, "references")]) {
    for (const m of h.matchAll(MSGID_RE)) ids.add(`<${m[1]}>`);
  }
  for (const id of ids) {
    const hit = await find({ messageId: id });
    if (hit) return hit;
  }
  const tokens = new Set<string>();
  const direct = rawText.match(TOKEN_RE)?.[1];
  if (direct) tokens.add(direct);
  for (const h of ["to", "delivered-to", "x-original-to", "envelope-to"]) {
    const t = headerText(parsed, h).match(PLUS_RE)?.[1];
    if (t) tokens.add(t);
  }
  for (const token of tokens) {
    const hit = await find({ token });
    if (hit) return hit;
  }
  return null;
}

export async function handleInboundEmail(raw: Buffer | string): Promise<InboundResult> {
  const parsed = await simpleParser(raw);
  const rawText = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
  const message = await resolveMessage(parsed, rawText);
  if (!message) return { kind: "unmatched" };

  const kind = detectKind(parsed, rawText);

  if (kind === "complaint") {
    await withBusinessOnlyScope(message.businessId, async (tx) => {
      await addSuppression(tx, { businessId: null, email: message.toEmail, reason: "complaint", source: "inbound_arf" });
      await cancelPendingForEmail(tx, message.businessId, message.toEmail);
      await recordEmailEvent(tx, message, "complained", {});
    });
    return { kind: "complaint" };
  }

  if (kind === "bounce") {
    const hard = isHardBounce(rawText);
    await withBusinessOnlyScope(message.businessId, async (tx) => {
      await tx.campaignMessage.update({ where: { id: message.id }, data: { status: "bounced" } });
      await recordEmailEvent(tx, message, "bounced", { hard });
      if (hard) {
        // A permanent failure protects every Zeroid sender: platform-wide suppression.
        await addSuppression(tx, { businessId: null, email: message.toEmail, reason: "hard_bounce", source: "inbound_dsn" });
        await cancelPendingForEmail(tx, message.businessId, message.toEmail);
      }
    });
    return { kind: "bounce", hard };
  }

  // --- a reply -------------------------------------------------------------------------
  const body = stripQuoted(parsed.text ?? "");
  const auto = isAutoReply(parsed);

  const campaign = await withBusinessOnlyScope(message.businessId, (tx) =>
    tx.campaign.findFirst({ where: { id: message.campaignId }, select: { organizationId: true } })
  );
  const { cls, via } = auto
    ? { cls: "out_of_office" as ReplyClass, via: "rules" }
    : await classifyReply(parsed.text ?? "", campaign ? { organizationId: campaign.organizationId, businessId: message.businessId } : undefined);

  await withBusinessOnlyScope(message.businessId, async (tx) => {
    await recordEmailEvent(tx, message, "replied", { class: cls, via, auto, snippet: body.slice(0, 300) });
    await recordLeadEvent(tx, { businessId: message.businessId, leadId: message.leadId, type: "email_reply", payload: { class: cls, snippet: body.slice(0, 300) } });

    // An auto-reply is not a human answering: keep the sequence going. Anything else stops it.
    if (cls !== "out_of_office") {
      await tx.campaignMessage.updateMany({
        where: { businessId: message.businessId, campaignId: message.campaignId, leadId: message.leadId, status: { in: ["scheduled", "sending"] } },
        data: { status: "cancelled" },
      });
    }

    const lead = await tx.lead.findFirst({ where: { id: message.leadId }, select: { name: true, company: true, stage: true } });
    const who = lead?.name || lead?.company || message.toEmail;

    if (cls === "unsubscribe") {
      await addSuppression(tx, { businessId: message.businessId, email: message.toEmail, reason: "unsubscribe", source: "reply" });
      await cancelPendingForEmail(tx, message.businessId, message.toEmail);
      await recordEmailEvent(tx, message, "unsubscribed", { via: "reply" });
    } else if (cls === "interested") {
      if (lead && (lead.stage === "new" || lead.stage === "contacted")) await tx.lead.update({ where: { id: message.leadId }, data: { stage: "engaged" } });
      await tx.task.create({
        data: {
          businessId: message.businessId,
          leadId: message.leadId,
          title: `Interested reply from ${who}: follow up`,
          note: `They wrote:\n${body.slice(0, 600)}`,
          dueAt: new Date(Date.now() + 24 * 3_600_000),
        },
      });
    } else if (cls === "other") {
      await tx.task.create({
        data: {
          businessId: message.businessId,
          leadId: message.leadId,
          title: `Review reply from ${who}`,
          note: `Zeroid could not tell what this reply means. They wrote:\n${body.slice(0, 600)}`,
        },
      });
    }
  });
  return { kind: "reply", cls, via };
}
