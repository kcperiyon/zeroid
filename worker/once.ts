/**
 * Runs ONE processing pass for every business and prints what happened, then exits. Handy for
 * checking a campaign by hand without waiting for the worker's timer:  npm run worker:once
 */
import { db } from "../src/lib/db";
import { withOrgScope } from "../src/lib/tenant-db";
import { processDueMessages } from "../src/lib/email-campaigns/engine";
import { liveSendingEnabled, parseAllowList } from "../src/lib/email-campaigns/guard";

async function main() {
  console.log(`Sandbox allow-list: ${parseAllowList().size} address(es). Live sending: ${liveSendingEnabled() ? "ENABLED" : "disabled"}.`);
  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  for (const org of orgs) {
    const businesses = await withOrgScope(org.id, (tx) => tx.business.findMany({ where: { organizationId: org.id }, select: { id: true, name: true } }));
    for (const b of businesses) {
      const r = await processDueMessages(org.id, b.id);
      if (Object.values(r).some((n) => n > 0)) console.log(`${org.slug} / ${b.name}:`, JSON.stringify(r));
    }
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
