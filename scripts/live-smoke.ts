// Manual live check (not part of the test suite): one tiny real job against the public services.
import { db } from "../src/lib/db";
import { withBusinessScope, withOrgScope } from "../src/lib/tenant-db";
import { createJob } from "../src/lib/discovery/runner";
import { discoveryTick } from "../src/lib/discovery/tick";

async function main() {
  const org = await db.organization.create({ data: { name: "Live smoke", slug: `live-smoke-${Date.now()}` } });
  const biz = await withOrgScope(org.id, (tx) => tx.business.create({ data: { organizationId: org.id, name: "Smoke" } }));
  const job = await createJob(org.id, biz.id, {
    name: "smoke", industries: [process.argv[2] ?? "accountants"], locations: [process.argv[3] ?? "Kensington, London, United Kingdom"],
    sources: ["osm"], maxProspects: Number(process.argv[4] ?? 6), maxCells: 12, autoEnrich: true,
  });
  console.log("org", org.id, "business", biz.id, "job", job.id);
  for (let i = 0; i < Number(process.argv[5] ?? 6); i++) {
    const t = await discoveryTick({ cellBudgetMs: 60_000, enrichBudgetMs: 90_000, onError: (w, e) => console.error(w, e) });
    const j = await withBusinessScope(org.id, biz.id, (tx) => tx.discoveryJob.findUniqueOrThrow({ where: { id: job.id } }));
    console.log(`pass ${i + 1}`, JSON.stringify(t), "job:", j.status, `cells ${j.cellsDone}/${j.cellsTotal}`, `found ${j.found} dup ${j.duplicates}`, j.lastError ?? "");
    const pending = await withBusinessScope(org.id, biz.id, (tx) => tx.prospect.count({ where: { enrichStatus: { in: ["pending", "running"] } } }));
    if (["done", "failed", "cancelled"].includes(j.status) && pending === 0) break;
  }
  const rows = await withBusinessScope(org.id, biz.id, (tx) => tx.prospect.findMany({ include: { emails: { orderBy: { confidence: "desc" } } }, orderBy: { createdAt: "asc" } }));
  for (const p of rows) {
    console.log(`\n# ${p.name} | ${p.website ?? "no site"} | ${p.enrichStatus}${p.enrichError ? ` (${p.enrichError})` : ""} | best ${p.bestEmailConfidence ?? "-"}`);
    for (const e of p.emails.slice(0, 4)) console.log(`   ${e.confidence}\t${e.kind}\t${e.email}\t${e.source.slice(0, 60)}`);
    if (p.researchNote) console.log("   note:", p.researchNote.slice(0, 300));
  }
  console.log("\nCLEANUP org", org.id, biz.id);
  await withBusinessScope(org.id, biz.id, async (tx) => {
    await tx.prospectEmail.deleteMany({}); await tx.prospect.deleteMany({}); await tx.discoveryCell.deleteMany({}); await tx.discoveryJob.deleteMany({});
  });
  await withOrgScope(org.id, (tx) => tx.business.deleteMany({ where: { organizationId: org.id } }));
  await db.organization.deleteMany({ where: { id: org.id } });
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
