import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { checkSendAllowed, SandboxBlockedError } from "@/lib/email-campaigns/guard";
import { SENDERS } from "@/lib/email-campaigns/senders";
import { buildMessage } from "@/lib/email-campaigns/template";
import { looksLikeEmail } from "@/lib/email-campaigns/suppression";

const Schema = z.object({ to: z.string().trim().toLowerCase().refine(looksLikeEmail, "Enter a valid email address."), step: z.number().int().min(1).max(6).default(1) });

/**
 * Sends ONE step to an address you control, to see it in a real inbox. It goes through the same
 * sandbox guard as everything else, so it only works for addresses on CAMPAIGN_SANDBOX_ALLOWLIST.
 * The unsubscribe/tracking links in a test email are inert (they carry a dummy token).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; campaignId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { campaignId } = await context.params;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });

  const campaign = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.campaign.findFirst({
      where: { id: campaignId, businessId: auth.businessId },
      include: { identity: true, sequence: { include: { steps: true } } },
    })
  );
  const step = campaign?.sequence?.steps.find((s) => s.position === parsed.data.step);
  if (!campaign || !step) return NextResponse.json({ error: "Step not found." }, { status: 404 });

  const decision = checkSendAllowed(campaign.identity, parsed.data.to);
  if (!decision.allowed) return NextResponse.json({ error: `Not sent: ${decision.reason}` }, { status: 403 });

  const base = (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  const built = buildMessage({
    subjectTemplate: step.subject,
    bodyTemplate: step.body,
    vars: { firstName: "Alex", name: "Alex Morgan", company: "Example Ltd", senderName: campaign.identity.fromName, email: parsed.data.to },
    token: "TESTSEND" + randomBytes(10).toString("hex"),
    baseUrl: base,
    fromName: campaign.identity.fromName,
    fromEmail: campaign.identity.fromEmail,
    replyToEmail: campaign.identity.replyToEmail,
    physicalAddress: campaign.identity.physicalAddress,
  });
  try {
    const sent = await SENDERS[campaign.identity.provider].send(campaign.identity, {
      to: parsed.data.to,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: built.headers,
      replyTo: built.replyTo,
      messageId: `<test.${randomBytes(8).toString("hex")}@${campaign.identity.fromEmail.split("@")[1]}>`,
    });
    return NextResponse.json({ ok: true, mode: sent.mode });
  } catch (error) {
    if (error instanceof SandboxBlockedError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Send failed." }, { status: 502 });
  }
}
