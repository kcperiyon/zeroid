import { NextResponse } from "next/server";
import { withBusinessScope } from "@/lib/tenant-db";
import { authorizeBusiness, CAMPAIGN_ROLES } from "@/lib/api-auth";
import { checkDomainHealth } from "@/lib/email-campaigns/domain-health";
import { openSecret } from "@/lib/secrets";

/** Runs the SPF / DKIM / DMARC / MX checks for this identity sending domain. */
export async function POST(_request: Request, context: { params: Promise<{ id: string; identityId: string }> }) {
  const auth = await authorizeBusiness(context, CAMPAIGN_ROLES);
  if ("error" in auth) return auth.error;
  const { identityId } = await context.params;
  const identity = await withBusinessScope(auth.user.organizationId, auth.businessId, (tx) =>
    tx.sendingIdentity.findFirst({ where: { id: identityId, businessId: auth.businessId } })
  );
  if (!identity) return NextResponse.json({ error: "Sending identity not found." }, { status: 404 });

  const domain = identity.dkimDomain || identity.fromEmail.split("@")[1];
  if (!domain) return NextResponse.json({ error: "This identity has no sending domain." }, { status: 400 });
  const checks = await checkDomainHealth(domain, {
    selector: identity.dkimSelector,
    privateKeyPem: openSecret(identity.dkimPrivateKey),
    spfInclude: identity.provider === "brevo_shared" ? "brevo" : undefined,
  });
  return NextResponse.json({ domain, provider: identity.provider, checks });
}
