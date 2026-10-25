import type { Prisma } from "@/generated/prisma/client";
import { withBusinessOnlyScope, withMessageLookupScope } from "@/lib/tenant-db";
import { recordLeadEvent } from "@/lib/lead-events";
import { recordEmailEvent } from "./engine";
import { addSuppression } from "./suppression";

type Tx = Prisma.TransactionClient;

/** Cancels every email still waiting to go to this address from this business. */
export async function cancelPendingForEmail(tx: Tx, businessId: string, email: string) {
  return tx.campaignMessage.updateMany({
    where: { businessId, toEmail: email.trim().toLowerCase(), status: { in: ["scheduled", "sending"] } },
    data: { status: "cancelled" },
  });
}

export type UnsubscribeResult =
  | { ok: false }
  | { ok: true; email: string; scope: "business" | "global"; senderName: string; physicalAddress: string };

/**
 * Honours an unsubscribe INSTANTLY: the address is suppressed and every pending email to it is
 * cancelled in the same transaction. scope "business" stops this sender; "global" is the
 * platform-wide never-email-me list. Idempotent, so scanners or double-clicks do no harm.
 */
export async function unsubscribeByToken(token: string, scope: "business" | "global" = "business"): Promise<UnsubscribeResult> {
  if (!token || token.length < 16) return { ok: false };

  const found = await withMessageLookupScope({ token }, (tx) =>
    tx.campaignMessage.findFirst({ where: { token }, select: { id: true, businessId: true, campaignId: true, leadId: true, toEmail: true } })
  );
  if (!found) return { ok: false };

  return withBusinessOnlyScope(found.businessId, async (tx) => {
    const identity = await tx.campaign
      .findFirst({ where: { id: found.campaignId }, select: { identity: { select: { fromName: true, physicalAddress: true } } } })
      .then((c) => c?.identity);

    await addSuppression(tx, {
      businessId: scope === "global" ? null : found.businessId,
      email: found.toEmail,
      reason: scope === "global" ? "global_optout" : "unsubscribe",
      source: "unsubscribe_link",
    });
    // A business-level unsubscribe still applies to this business; a global one is also recorded here.
    if (scope === "global") await addSuppression(tx, { businessId: found.businessId, email: found.toEmail, reason: "unsubscribe", source: "unsubscribe_link" });

    await cancelPendingForEmail(tx, found.businessId, found.toEmail);

    const already = await tx.emailEvent.count({ where: { messageId: found.id, type: "unsubscribed" } });
    if (!already) {
      await recordEmailEvent(tx, found, "unsubscribed", { scope });
      await recordLeadEvent(tx, { businessId: found.businessId, leadId: found.leadId, type: "email_unsubscribed", payload: { scope } });
    }
    return {
      ok: true as const,
      email: found.toEmail,
      scope,
      senderName: identity?.fromName ?? "this sender",
      physicalAddress: identity?.physicalAddress ?? "",
    };
  });
}

// --- open / click tracking ---------------------------------------------------------------

export async function recordOpen(token: string, meta: { userAgent?: string } = {}) {
  const found = await withMessageLookupScope({ token }, (tx) =>
    tx.campaignMessage.findFirst({ where: { token }, select: { id: true, businessId: true, campaignId: true, leadId: true } })
  );
  if (!found) return false;
  await withBusinessOnlyScope(found.businessId, (tx) => recordEmailEvent(tx, found, "opened", { ua: meta.userAgent?.slice(0, 120) }));
  return true;
}

export async function recordClick(token: string, url: string) {
  const found = await withMessageLookupScope({ token }, (tx) =>
    tx.campaignMessage.findFirst({ where: { token }, select: { id: true, businessId: true, campaignId: true, leadId: true } })
  );
  if (!found) return false;
  await withBusinessOnlyScope(found.businessId, async (tx) => {
    await recordEmailEvent(tx, found, "clicked", { url: url.slice(0, 500) });
    await recordLeadEvent(tx, { businessId: found.businessId, leadId: found.leadId, type: "email_clicked", payload: { url: url.slice(0, 500) } });
  });
  return true;
}
