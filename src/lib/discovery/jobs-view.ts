import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/** Recent searches with how many of their companies are waiting, checked, skipped or failed. */
export async function listJobsWithCounts(tx: Tx, businessId: string) {
  const jobs = await tx.discoveryJob.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 30 });
  const counts = await tx.prospect.groupBy({
    by: ["discoveryJobId", "enrichStatus"],
    where: { businessId, discoveryJobId: { not: null } },
    _count: { _all: true },
  });
  return jobs.map((j) => {
    const by = Object.fromEntries(counts.filter((c) => c.discoveryJobId === j.id).map((c) => [c.enrichStatus, c._count._all]));
    return { ...j, enrichment: { pending: (by.pending ?? 0) + (by.running ?? 0), done: by.done ?? 0, skipped: by.skipped ?? 0, failed: by.failed ?? 0 } };
  });
}
