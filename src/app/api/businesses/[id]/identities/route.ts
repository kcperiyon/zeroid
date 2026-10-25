import { NextResponse } from "next/server";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { IdentityCreateSchema, publicIdentity, sealIdentitySecrets } from "@/lib/email-campaigns/identity-schema";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const rows = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.sendingIdentity.findMany({ where: { businessId: auth.businessId }, orderBy: { createdAt: "asc" } })
  );
  return NextResponse.json({ identities: rows.map(publicIdentity) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeBusiness(context, ["owner", "admin"]);
  if ("error" in auth) return auth.error;
  const parsed = IdentityCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid details." }, { status: 400 });
  const d = parsed.data;
  if (d.provider === "smtp" && !d.smtpHost) return NextResponse.json({ error: "SMTP identities need a server (host)." }, { status: 400 });

  const created = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.sendingIdentity.create({
      data: {
        businessId: auth.businessId,
        name: d.name,
        provider: d.provider,
        fromEmail: d.fromEmail,
        fromName: d.fromName,
        replyToEmail: d.replyToEmail,
        physicalAddress: d.physicalAddress,
        smtpHost: d.smtpHost,
        smtpPort: d.smtpPort,
        smtpSecure: d.smtpSecure ?? false,
        smtpUser: d.smtpUser,
        dkimDomain: d.dkimDomain,
        dkimSelector: d.dkimSelector,
        imapHost: d.imapHost,
        imapPort: d.imapPort,
        imapSecure: d.imapSecure ?? true,
        imapUser: d.imapUser,
        imapFolder: d.imapFolder || "INBOX",
        ...sealIdentitySecrets(d),
        dailyCap: d.dailyCap ?? 20,
        perDomainHourlyCap: d.perDomainHourlyCap ?? 5,
        warmupStartedAt: new Date(),
        sandboxOnly: true, // always starts sandboxed
      },
    })
  );
  return NextResponse.json({ identity: publicIdentity(created) }, { status: 201 });
}
