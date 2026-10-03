import type { Prisma } from "@/generated/prisma/client";
import { recordLeadEvent } from "@/lib/lead-events";

type Tx = Prisma.TransactionClient;

export type IntakeChannel =
  | "api" | "webhook" | "facebook" | "instagram" | "google" | "tiktok" | "linkedin" | "email";
export type IntakeMedium = "organic" | "paid";

const CHANNEL_LABEL: Record<string, string> = {
  api: "API",
  webhook: "Web form / webhook",
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  email: "Email",
};

export type IngestInput = {
  channel: IntakeChannel;
  medium: IntakeMedium;
  campaign?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  /** Free-text the person wrote (form message, DM, comment). Stored on the timeline event. */
  message?: string | null;
  /** Stable id of the person on a social platform (PSID / IG-scoped id), used to recognise repeat contacts. */
  socialId?: string | null;
  /** Extra answers (e.g. every Lead Ad form field) kept on the lead's contact JSON. */
  extra?: Record<string, unknown>;
  /** What happened, becomes the timeline event type for an existing lead (default "lead_inbound"). */
  eventType?: string;
  /** Unique id of the triggering message/comment/submission -- a repeated delivery of the same id is ignored. */
  dedupeId?: string | null;
  /** Open a task so a human replies (used for social DMs/comments). */
  createReplyTask?: boolean;
};

export type IngestResult = { leadId: string; created: boolean; duplicate: boolean };

const clean = (v: string | null | undefined, max = 300) => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

/**
 * One place that turns "someone showed up on channel X" into a Lead: finds the
 * existing lead for that email/phone/social id (so a repeat contact adds to
 * its timeline instead of duplicating it), or creates one with first-touch
 * source + medium + campaign. Callers supply a business-scoped transaction.
 */
export async function ingestLead(tx: Tx, businessId: string, input: IngestInput): Promise<IngestResult> {
  const email = clean(input.email, 200)?.toLowerCase();
  const phone = clean(input.phone, 40);
  const socialKey = input.socialId ? `${input.channel}Id` : null;

  if (input.dedupeId) {
    const seen = await tx.leadEvent.findFirst({
      where: { businessId, payload: { path: ["dedupeId"], equals: input.dedupeId } },
      select: { leadId: true },
    });
    if (seen) return { leadId: seen.leadId, created: false, duplicate: true };
  }

  const matchers: Prisma.LeadWhereInput[] = [];
  if (email) matchers.push({ email: { equals: email, mode: "insensitive" } });
  if (phone) matchers.push({ phone });
  if (socialKey && input.socialId) matchers.push({ contact: { path: [socialKey], equals: input.socialId } });

  const existing = matchers.length
    ? await tx.lead.findFirst({ where: { businessId, OR: matchers }, orderBy: { createdAt: "asc" } })
    : null;

  const eventPayload = {
    text: clean(input.message, 2000),
    channel: input.channel,
    medium: input.medium,
    campaign: clean(input.campaign, 200),
    dedupeId: input.dedupeId ?? undefined,
  };

  if (existing) {
    await recordLeadEvent(tx, {
      businessId,
      leadId: existing.id,
      type: input.eventType ?? "lead_inbound",
      payload: eventPayload,
    });
    return { leadId: existing.id, created: false, duplicate: false };
  }

  let source = await tx.leadSource.findFirst({ where: { businessId, channel: input.channel } });
  if (!source) {
    source = await tx.leadSource.create({
      data: { businessId, channel: input.channel, name: CHANNEL_LABEL[input.channel] ?? input.channel },
    });
  }

  const contact: Record<string, unknown> = { ...(input.extra ?? {}) };
  if (socialKey && input.socialId) contact[socialKey] = input.socialId;

  const lead = await tx.lead.create({
    data: {
      businessId,
      sourceId: source.id,
      medium: input.medium,
      campaign: clean(input.campaign, 200),
      name: clean(input.name, 200),
      email,
      phone,
      company: clean(input.company, 200),
      contact: contact as Prisma.InputJsonObject,
    },
  });
  await recordLeadEvent(tx, {
    businessId,
    leadId: lead.id,
    type: "lead_created",
    payload: { source: input.channel, medium: input.medium, campaign: clean(input.campaign, 200) },
  });
  if (eventPayload.text || input.dedupeId) {
    await recordLeadEvent(tx, {
      businessId,
      leadId: lead.id,
      type: input.eventType ?? "lead_inbound",
      payload: eventPayload,
    });
  }
  if (input.createReplyTask) {
    await tx.task.create({
      data: {
        businessId,
        leadId: lead.id,
        title: `Reply to ${clean(input.name, 80) ?? "a new lead"} on ${CHANNEL_LABEL[input.channel] ?? input.channel}`,
        note: eventPayload.text ? `They wrote: ${eventPayload.text}` : undefined,
      },
    });
  }
  return { leadId: lead.id, created: true, duplicate: false };
}
