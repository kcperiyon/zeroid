import { NextResponse } from "next/server";
import { z } from "zod";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { looksLikeEmail } from "@/lib/email-campaigns/suppression";

const emailField = z.string().trim().toLowerCase().refine(looksLikeEmail, "Enter a valid email address.");

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.enum(["brevo_shared", "smtp"]),
  fromEmail: emailField,
  fromName: z.string().trim().min(1).max(80),
  replyToEmail: emailField.optional().or(z.literal("").transform(() => undefined)),
  physicalAddress: z.string().trim().min(8, "A real postal address is required (it appears in every email).").max(300),
  smtpHost: z.string().trim().max(200).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(200).optional(),
  smtpPass: z.string().max(500).optional(),
  dkimDomain: z.string().trim().max(200).optional(),
  dkimSelector: z.string().trim().max(100).optional(),
  dkimPrivateKey: z.string().max(5000).optional(),
  dailyCap: z.number().int().min(1).max(5000).optional(),
});

/** Never send secrets back to the browser. */
export const publicIdentity = <T extends { smtpPass: string | null; dkimPrivateKey: string | null }>(i: T) => {
  const { smtpPass, dkimPrivateKey, ...rest } = i;
  return { ...rest, hasSmtpPassword: Boolean(smtpPass), hasDkimKey: Boolean(dkimPrivateKey) };
};

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
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
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
        smtpPass: d.smtpPass,
        dkimDomain: d.dkimDomain,
        dkimSelector: d.dkimSelector,
        dkimPrivateKey: d.dkimPrivateKey,
        dailyCap: d.dailyCap ?? 20,
        warmupStartedAt: new Date(),
        sandboxOnly: true, // always starts sandboxed; see the identity PATCH route to change
      },
    })
  );
  return NextResponse.json({ identity: publicIdentity(created) }, { status: 201 });
}
