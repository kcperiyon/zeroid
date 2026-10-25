import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { withBusinessScope } from "@/lib/tenant-db";
import { generate } from "@/lib/ai";
import { recordLeadEvent } from "@/lib/lead-events";
import { SandboxBlockedError } from "./guard";
import { domainAcceptsMail } from "./mx";
import { effectiveDailyCap, isInsideWindow, isValidTimezone, nextAllowedTime, type SendWindow } from "./schedule";
import { SENDERS, type EmailSender, type SenderIdentity } from "./senders";
import { findSuppression, looksLikeEmail, normaliseEmail } from "./suppression";
import { parseSegmentFilter, segmentWhere } from "./segments";
import { buildMessage, firstNameOf } from "./template";
import { PLACEHOLDER_MARK } from "./defaults";

type Tx = Prisma.TransactionClient;

export class CampaignError extends Error {}

export type EngineDeps = {
  now?: () => Date;
  senders?: Record<SenderIdentity["provider"], EmailSender>;
  baseUrl?: string;
  /** Optional AI opening line for steps with aiPersonalise; returns null to skip. */
  personalise?: (ctx: { organizationId: string; businessId: string; leadName: string; company: string; objective: string }) => Promise<string | null>;
  mxCheck?: (domain: string) => Promise<boolean>;
};

const MAX_ATTEMPTS = 3;
const CLAIM_BATCH = 25;
const MAX_RECIPIENTS = 5000;
const STOP_EVENTS = ["replied", "unsubscribed", "bounced", "complained"] as const;

const newToken = () => randomBytes(18).toString("base64url");
const jitterMs = (maxMinutes: number) => Math.floor(Math.random() * maxMinutes * 60_000);
const baseUrlOf = (deps: EngineDeps) => (deps.baseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

function leadWindow(campaign: { timezone: string; sendStartHour: number; sendEndHour: number; weekdaysOnly: boolean }, leadContact: unknown): SendWindow {
  const tz = (leadContact as { timezone?: unknown } | null)?.timezone;
  return {
    timezone: typeof tz === "string" && isValidTimezone(tz) ? tz : isValidTimezone(campaign.timezone) ? campaign.timezone : "UTC",
    startHour: campaign.sendStartHour,
    endHour: campaign.sendEndHour,
    weekdaysOnly: campaign.weekdaysOnly,
  };
}

export async function recordEmailEvent(
  tx: Tx,
  msg: { businessId: string; campaignId: string; id: string; leadId: string },
  type: "sent" | "delivered" | "bounced" | "opened" | "clicked" | "replied" | "unsubscribed" | "complained" | "blocked",
  payload: Record<string, unknown> = {}
) {
  return tx.emailEvent.create({
    data: { businessId: msg.businessId, campaignId: msg.campaignId, messageId: msg.id, leadId: msg.leadId, type, payload: payload as Prisma.InputJsonObject },
  });
}

// ------------------------------------------------------------------------------------------
// Launch
// ------------------------------------------------------------------------------------------

export type LaunchResult = { scheduled: number; suppressed: number; invalid: number; duplicate: number; noEmail: number };

/** Validates a draft/paused campaign, expands its segment into step-1 messages, and activates it. */
export async function launchCampaign(
  organizationId: string,
  businessId: string,
  campaignId: string,
  deps: EngineDeps = {}
): Promise<LaunchResult> {
  const now = (deps.now ?? (() => new Date()))();
  const mx = deps.mxCheck ?? domainAcceptsMail;

  const prep = await withBusinessScope(organizationId, businessId, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, businessId },
      include: { segment: true, identity: true, sequence: { include: { steps: { orderBy: { position: "asc" } } } } },
    });
    if (!campaign) throw new CampaignError("Campaign not found.");
    if (campaign.status === "active") throw new CampaignError("This campaign is already running.");
    if (campaign.status === "completed") throw new CampaignError("This campaign has finished.");

    const steps = campaign.sequence?.steps ?? [];
    if (steps.length === 0) throw new CampaignError("Add at least one email step to the sequence first.");
    for (const s of steps) {
      if (!s.subject.trim() || !s.body.trim()) throw new CampaignError(`Step ${s.position} needs a subject and a body.`);
      if (PLACEHOLDER_MARK.test(s.subject) || PLACEHOLDER_MARK.test(s.body)) {
        throw new CampaignError(`Step ${s.position} still has template text in [[double brackets]]. Rewrite it before launching.`);
      }
    }
    const id = campaign.identity;
    if (!id.active) throw new CampaignError("The sending identity is switched off.");
    if (!id.physicalAddress.trim()) throw new CampaignError("The sending identity needs a physical postal address (required in every email).");
    if (!looksLikeEmail(id.fromEmail)) throw new CampaignError("The sending identity has no valid from-address.");

    // Resuming a paused campaign: its messages already exist, just re-activate.
    if (campaign.status === "paused" && (await tx.campaignMessage.count({ where: { campaignId } })) > 0) {
      await tx.campaign.update({ where: { id: campaignId }, data: { status: "active" } });
      return { resumed: true as const };
    }

    const leads = await tx.lead.findMany({
      where: segmentWhere(businessId, parseSegmentFilter(campaign.segment.filter)),
      select: { id: true, email: true, contact: true },
      orderBy: { createdAt: "asc" },
      take: MAX_RECIPIENTS,
    });
    const emails = leads.map((l) => normaliseEmail(l.email ?? ""));
    const suppressed = new Set(
      (
        await tx.suppression.findMany({
          where: { email: { in: emails }, OR: [{ businessId: null }, { businessId }] },
          select: { email: true },
        })
      ).map((s) => s.email)
    );
    return { resumed: false as const, campaign, steps, leads, suppressed };
  });

  if (prep.resumed) return { scheduled: 0, suppressed: 0, invalid: 0, duplicate: 0, noEmail: 0 };
  const { campaign, steps, leads, suppressed } = prep;

  const result: LaunchResult = { scheduled: 0, suppressed: 0, invalid: 0, duplicate: 0, noEmail: 0 };
  const seen = new Set<string>();
  const rows: Prisma.CampaignMessageCreateManyInput[] = [];

  for (const lead of leads) {
    const email = normaliseEmail(lead.email ?? "");
    if (!email) {
      result.noEmail++;
      continue;
    }
    if (seen.has(email)) {
      result.duplicate++;
      continue;
    }
    seen.add(email);
    if (suppressed.has(email)) {
      result.suppressed++;
      continue;
    }
    if (!looksLikeEmail(email) || !(await mx(email.split("@")[1]))) {
      result.invalid++;
      continue;
    }
    const window = leadWindow(campaign, lead.contact);
    rows.push({
      businessId,
      campaignId,
      leadId: lead.id,
      stepId: steps[0].id,
      toEmail: email,
      token: newToken(),
      status: "scheduled",
      scheduledFor: nextAllowedTime(new Date(now.getTime() + jitterMs(30)), window),
    });
  }

  await withBusinessScope(organizationId, businessId, async (tx) => {
    if (rows.length) await tx.campaignMessage.createMany({ data: rows, skipDuplicates: true });
    await tx.campaign.update({ where: { id: campaignId }, data: { status: "active", startedAt: now } });
  });
  result.scheduled = rows.length;
  return result;
}

export async function pauseCampaign(organizationId: string, businessId: string, campaignId: string) {
  await withBusinessScope(organizationId, businessId, (tx) =>
    tx.campaign.updateMany({ where: { id: campaignId, businessId, status: "active" }, data: { status: "paused" } })
  );
}

// ------------------------------------------------------------------------------------------
// Processing due messages (called by the worker loop)
// ------------------------------------------------------------------------------------------

export type ProcessResult = { sent: number; skipped: number; rescheduled: number; failed: number; cancelled: number };

async function defaultPersonalise(ctx: Parameters<NonNullable<EngineDeps["personalise"]>>[0]): Promise<string | null> {
  try {
    const out = await generate(ctx.organizationId, ctx.businessId, "content_generation", {
      system: "You write one short, genuine opening sentence for a B2B cold email. Never flatter, never invent facts about the recipient.",
      prompt:
        `Recipient: ${ctx.leadName || "a decision maker"} at ${ctx.company || "their company"}.\nOur objective: ${ctx.objective || "start a conversation"}.\n` +
        "Write ONE sentence (max 25 words), no greeting, no quotes.",
      maxTokens: 80,
    });
    const line = out.text.trim().replace(/^["']|["']$/g, "");
    return line.length > 0 && line.length < 300 ? line : null;
  } catch {
    return null; // out of credits or provider down: send the plain template instead
  }
}

export async function processDueMessages(organizationId: string, businessId: string, deps: EngineDeps = {}): Promise<ProcessResult> {
  const now = (deps.now ?? (() => new Date()))();
  const out: ProcessResult = { sent: 0, skipped: 0, rescheduled: 0, failed: 0, cancelled: 0 };

  const campaigns = await withBusinessScope(organizationId, businessId, (tx) =>
    tx.campaign.findMany({
      where: { businessId, status: "active" },
      include: { identity: true, sequence: { include: { steps: { orderBy: { position: "asc" } } } } },
    })
  );

  for (const campaign of campaigns) {
    const identity = campaign.identity;
    // Daily cap (with warm-up), counted across ALL campaigns on this identity in the last 24h.
    const sentToday = await withBusinessScope(organizationId, businessId, (tx) =>
      tx.campaignMessage.count({
        where: { businessId, status: "sent", sentAt: { gte: new Date(now.getTime() - 86_400_000) }, campaign: { identityId: identity.id } },
      })
    );
    const room = effectiveDailyCap(identity.dailyCap, identity.warmupStartedAt, now) - sentToday;
    if (room <= 0) continue;

    const claimed = await withBusinessScope(organizationId, businessId, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "CampaignMessage"
        WHERE "campaignId" = ${campaign.id} AND status = 'scheduled' AND "scheduledFor" <= ${now}
        ORDER BY "scheduledFor" ASC
        LIMIT ${Math.min(CLAIM_BATCH, room)}
        FOR UPDATE SKIP LOCKED`;
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        await tx.campaignMessage.updateMany({ where: { id: { in: ids } }, data: { status: "sending", attempts: { increment: 1 } } });
      }
      return ids;
    });

    for (const id of claimed) {
      const r = await processOne(organizationId, businessId, campaign, identity, id, now, deps);
      out[r]++;
    }

    // Finished when nothing is left to send.
    await withBusinessScope(organizationId, businessId, async (tx) => {
      const open = await tx.campaignMessage.count({ where: { campaignId: campaign.id, status: { in: ["scheduled", "sending"] } } });
      if (open === 0) await tx.campaign.updateMany({ where: { id: campaign.id, status: "active" }, data: { status: "completed" } });
    });
  }
  return out;
}

type CampaignWithSteps = Prisma.CampaignGetPayload<{ include: { identity: true; sequence: { include: { steps: true } } } }>;

async function processOne(
  organizationId: string,
  businessId: string,
  campaign: CampaignWithSteps,
  identity: CampaignWithSteps["identity"],
  messageId: string,
  now: Date,
  deps: EngineDeps
): Promise<keyof ProcessResult> {
  const senders = deps.senders ?? SENDERS;

  const ctx = await withBusinessScope(organizationId, businessId, async (tx) => {
    const message = await tx.campaignMessage.findFirst({ where: { id: messageId }, include: { lead: true, step: true } });
    if (!message) return null;
    const suppression = await findSuppression(tx, businessId, message.toEmail);
    const stopped = await tx.emailEvent.count({
      where: { businessId, campaignId: campaign.id, leadId: message.leadId, type: { in: [...STOP_EVENTS] } },
    });
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const domain = message.toEmail.split("@")[1] ?? "";
    const sentToDomain = await tx.campaignMessage.count({
      where: { businessId, status: "sent", sentAt: { gte: hourAgo }, toEmail: { endsWith: `@${domain}` }, campaign: { identityId: identity.id } },
    });
    return { message, suppression, stopped, sentToDomain };
  });
  if (!ctx) return "skipped";
  const { message, suppression, stopped, sentToDomain } = ctx;

  const finish = (status: "skipped" | "cancelled" | "failed", event?: { type: "blocked"; payload: Record<string, unknown> }, error?: string) =>
    withBusinessScope(organizationId, businessId, async (tx) => {
      await tx.campaignMessage.update({ where: { id: message.id }, data: { status, error: error?.slice(0, 500) } });
      if (event) await recordEmailEvent(tx, message, event.type, event.payload);
    });

  if (suppression) {
    await finish("skipped", { type: "blocked", payload: { reason: "suppressed", scope: suppression.businessId ? "business" : "global", why: suppression.reason } });
    return "skipped";
  }
  if (stopped > 0) {
    await finish("cancelled");
    return "cancelled";
  }

  const reschedule = async (to: Date, giveBackAttempt: boolean) => {
    await withBusinessScope(organizationId, businessId, (tx) =>
      tx.campaignMessage.update({
        where: { id: message.id },
        data: { status: "scheduled", scheduledFor: to, ...(giveBackAttempt ? { attempts: { decrement: 1 } } : {}) },
      })
    );
    return "rescheduled" as const;
  };

  const window = leadWindow(campaign, message.lead.contact);
  if (!isInsideWindow(now, window)) return reschedule(nextAllowedTime(now, window), true);
  if (sentToDomain >= identity.perDomainHourlyCap) return reschedule(new Date(now.getTime() + 30 * 60_000 + jitterMs(30)), true);

  const vars = {
    firstName: firstNameOf(message.lead.name),
    name: message.lead.name ?? "",
    company: message.lead.company ?? "",
    senderName: identity.fromName,
    email: message.toEmail,
  };
  let openingLine: string | null = null;
  if (message.step.aiPersonalise) {
    openingLine = await (deps.personalise ?? defaultPersonalise)({
      organizationId,
      businessId,
      leadName: message.lead.name ?? "",
      company: message.lead.company ?? "",
      objective: campaign.objective ?? "",
    });
  }
  const built = buildMessage({
    subjectTemplate: message.step.subject,
    bodyTemplate: message.step.body,
    vars,
    token: message.token,
    baseUrl: baseUrlOf(deps),
    fromName: identity.fromName,
    fromEmail: identity.fromEmail,
    replyToEmail: identity.replyToEmail,
    physicalAddress: identity.physicalAddress,
    openingLine,
  });
  const sendDomain = identity.fromEmail.split("@")[1] ?? "localhost";
  const smtpMessageId = `<${message.token}.${randomBytes(6).toString("hex")}@${sendDomain}>`;

  try {
    const sent = await senders[identity.provider].send(identity, {
      to: message.toEmail,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: built.headers,
      replyTo: built.replyTo,
      messageId: smtpMessageId,
    });

    await withBusinessScope(organizationId, businessId, async (tx) => {
      await tx.campaignMessage.update({
        where: { id: message.id },
        data: { status: "sent", sentAt: now, messageId: smtpMessageId, subject: built.subject, bodyHtml: built.html, error: null },
      });
      await recordEmailEvent(tx, message, "sent", { mode: sent.mode, step: message.step.position });
      await recordLeadEvent(tx, { businessId, leadId: message.leadId, type: "email_sent", payload: { campaignId: campaign.id, step: message.step.position, mode: sent.mode } });
      if (message.lead.stage === "new") await tx.lead.update({ where: { id: message.leadId }, data: { stage: "contacted" } });

      // Schedule the next step, if there is one.
      const steps = campaign.sequence?.steps ?? [];
      const next = steps.find((s) => s.position > message.step.position);
      if (next) {
        const due = new Date(now.getTime() + next.delayDays * 86_400_000 + jitterMs(30));
        await tx.campaignMessage.createMany({
          data: [
            {
              businessId,
              campaignId: campaign.id,
              leadId: message.leadId,
              stepId: next.id,
              toEmail: message.toEmail,
              token: newToken(),
              status: "scheduled",
              scheduledFor: nextAllowedTime(due, window),
            },
          ],
          skipDuplicates: true,
        });
      }
    });
    return "sent";
  } catch (error) {
    if (error instanceof SandboxBlockedError) {
      await finish("skipped", { type: "blocked", payload: { reason: "sandbox", detail: error.reason } }, error.reason);
      return "skipped";
    }
    const text = error instanceof Error ? error.message : "Send failed.";
    if (message.attempts >= MAX_ATTEMPTS) {
      await finish("failed", undefined, text);
      return "failed";
    }
    await withBusinessScope(organizationId, businessId, (tx) =>
      tx.campaignMessage.update({
        where: { id: message.id },
        data: { status: "scheduled", error: text.slice(0, 500), scheduledFor: new Date(now.getTime() + message.attempts * 15 * 60_000) },
      })
    );
    return "rescheduled";
  }
}

// ------------------------------------------------------------------------------------------
// Stats for the campaign page
// ------------------------------------------------------------------------------------------

export async function campaignStats(tx: Tx, campaignId: string) {
  const [byStatus, events] = await Promise.all([
    tx.campaignMessage.groupBy({ by: ["status"], where: { campaignId }, _count: true }),
    tx.emailEvent.groupBy({ by: ["type"], where: { campaignId }, _count: { messageId: true } }),
  ]);
  // Distinct messages per event type (a message opened 5 times counts once).
  const distinct: Record<string, number> = {};
  for (const e of events) {
    distinct[e.type] = (
      await tx.emailEvent.findMany({ where: { campaignId, type: e.type }, distinct: ["messageId"], select: { messageId: true } })
    ).length;
  }
  return { messages: Object.fromEntries(byStatus.map((s) => [s.status, s._count])), events: distinct };
}
