import { NextResponse } from "next/server";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { openImap } from "@/lib/email-campaigns/mailbox";
import { openSecret } from "@/lib/secrets";

/** Tries to log in to the identity reply mailbox (read-only) and reports success or the exact problem. */
export async function POST(_request: Request, context: { params: Promise<{ id: string; identityId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { identityId } = await context.params;
  const id = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.sendingIdentity.findFirst({ where: { id: identityId, businessId: auth.businessId } })
  );
  if (!id) return NextResponse.json({ error: "Sending identity not found." }, { status: 404 });
  if (!id.imapHost || !id.imapUser) return NextResponse.json({ error: "No reply mailbox is set up on this identity yet." }, { status: 400 });

  try {
    const session = await openImap({
      host: id.imapHost,
      port: id.imapPort ?? (id.imapSecure ? 993 : 143),
      secure: id.imapSecure,
      user: id.imapUser,
      pass: openSecret(id.imapPass) ?? "",
      folder: id.imapFolder || "INBOX",
    });
    await session.close();
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Message only; never echo credentials.
    return NextResponse.json({ ok: false, error: (error instanceof Error ? error.message : "Could not connect.").slice(0, 300) }, { status: 200 });
  }
}
