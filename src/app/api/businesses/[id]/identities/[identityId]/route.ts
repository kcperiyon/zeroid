import { NextResponse } from "next/server";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness } from "@/lib/api-auth";
import { IdentityUpdateSchema, publicIdentity, sealIdentitySecrets } from "@/lib/email-campaigns/identity-schema";

type Ctx = { params: Promise<{ id: string; identityId: string }> };

/**
 * Edit an identity. Blank secret fields keep the stored value. Turning sandbox OFF is the one
 * sensitive change: owners only, never for the shared Brevo account, and the server still needs
 * CAMPAIGN_ALLOW_LIVE_SENDING before anything real is sent.
 */
export async function PATCH(request: Request, context: Ctx) {
  const auth = await authorizeBusiness(context, ["owner", "admin"]);
  if ("error" in auth) return auth.error;
  const { identityId } = await context.params;
  const parsed = IdentityUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid changes." }, { status: 400 });
  const d = parsed.data;

  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const current = await tx.sendingIdentity.findFirst({ where: { id: identityId, businessId: auth.businessId } });
    if (!current) return { status: 404, error: "Sending identity not found." };

    const provider = d.provider ?? current.provider;
    if (d.sandboxOnly === false) {
      if (auth.user.role !== "owner") return { status: 403, error: "Only an owner can take an identity out of sandbox mode." };
      if (provider === "brevo_shared") return { status: 400, error: "The shared Brevo account can never leave sandbox mode." };
    }
    if (d.provider && d.provider !== current.provider) {
      const running = await tx.campaign.count({ where: { identityId, status: "active" } });
      if (running > 0) return { status: 409, error: "Pause the campaigns using this identity before changing its provider." };
    }
    if (provider === "smtp" && !(d.smtpHost ?? current.smtpHost)) return { status: 400, error: "SMTP identities need a server (host)." };

    // A provider switch back to the shared account re-locks it into sandbox.
    const forceSandbox = provider === "brevo_shared";
    const { smtpPass, dkimPrivateKey, imapPass, ...plain } = d;
    void smtpPass; void dkimPrivateKey; void imapPass;
    const updated = await tx.sendingIdentity.update({
      where: { id: identityId },
      data: { ...plain, ...sealIdentitySecrets(d), ...(forceSandbox ? { sandboxOnly: true } : {}) },
    });
    return { status: 200, identity: publicIdentity(updated) };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ identity: result.identity });
}

export async function DELETE(_request: Request, context: Ctx) {
  const auth = await authorizeBusiness(context, ["owner", "admin"]);
  if ("error" in auth) return auth.error;
  const { identityId } = await context.params;
  const result = await withBusinessScope(auth.user.organizationId, auth.businessId, async (tx) => {
    const used = await tx.campaign.count({ where: { identityId } });
    if (used > 0) return { status: 409, error: "This identity is used by a campaign. Delete those campaigns first, or switch it off instead." };
    const gone = await tx.sendingIdentity.deleteMany({ where: { id: identityId, businessId: auth.businessId } });
    return gone.count ? { status: 200 } : { status: 404, error: "Sending identity not found." };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
