import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/tenant-db";
import { planJobs, runCells, runEnrichment, type RunnerDeps } from "./runner";

export const discoveryEnabled = () => process.env.DISCOVERY_ENABLED !== "false";

export type DiscoveryTotals = { planned: number; cells: number; enriched: number };

/**
 * One pass over every business: plan new jobs, work through some cells, enrich some prospects.
 * Each phase has its own time budget so a slow public service cannot starve the others, and one
 * business failing never stops the rest.
 */
export async function discoveryTick(opts: { cellBudgetMs?: number; enrichBudgetMs?: number; deps?: RunnerDeps; onError?: (where: string, e: unknown) => void } = {}): Promise<DiscoveryTotals> {
  const totals: DiscoveryTotals = { planned: 0, cells: 0, enriched: 0 };
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    const businesses = await withOrgScope(org.id, (tx) => tx.business.findMany({ where: { organizationId: org.id }, select: { id: true } }));
    for (const b of businesses) {
      try {
        totals.planned += await planJobs(org.id, b.id, opts.deps);
        totals.cells += await runCells(org.id, b.id, opts.cellBudgetMs ?? 20_000, opts.deps);
        totals.enriched += await runEnrichment(org.id, b.id, opts.enrichBudgetMs ?? 25_000, opts.deps);
      } catch (e) {
        opts.onError?.(`business ${b.id}`, e);
      }
    }
  }
  return totals;
}
