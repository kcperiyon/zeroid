import { db } from "@/lib/db";
import { withBusinessScope, withOrgScope } from "@/lib/tenant-db";
import { isEncrypted, sealSecret } from "@/lib/secrets";

/**
 * One-off, idempotent: encrypts any identity credentials still stored in plaintext (rows saved
 * before encryption existed). Run by the worker at start-up; safe to run repeatedly.
 */
export async function upgradeIdentitySecrets(): Promise<number> {
  let upgraded = 0;
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    const businesses = await withOrgScope(org.id, (tx) => tx.business.findMany({ where: { organizationId: org.id }, select: { id: true } }));
    for (const b of businesses) {
      await withBusinessScope(org.id, b.id, async (tx) => {
        const ids = await tx.sendingIdentity.findMany({ where: { businessId: b.id } });
        for (const i of ids) {
          const needs = [i.smtpPass, i.dkimPrivateKey, i.imapPass].some((v) => v && !isEncrypted(v));
          if (!needs) continue;
          await tx.sendingIdentity.update({
            where: { id: i.id },
            data: { smtpPass: sealSecret(i.smtpPass), dkimPrivateKey: sealSecret(i.dkimPrivateKey), imapPass: sealSecret(i.imapPass) },
          });
          upgraded++;
        }
      });
    }
  }
  return upgraded;
}
