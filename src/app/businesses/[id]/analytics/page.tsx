import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope, withOrgScope } from "@/lib/tenant-db";
import { classifyTemperature } from "@/lib/scoring";

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const { leads, scoringConfig, deals, aiUsageLogs, openTasks } = await withBusinessScope(
    user.organizationId,
    businessId,
    async (tx) => {
      const [leads, scoringConfig, deals, aiUsageLogs, openTasks] = await Promise.all([
        tx.lead.findMany({ where: { businessId }, include: { source: true } }),
        tx.scoringConfig.findUnique({ where: { businessId } }),
        tx.deal.findMany({ where: { businessId } }),
        tx.aiUsageLog.findMany({ where: { businessId } }),
        tx.task.count({ where: { businessId, status: "open" } }),
      ]);
      return { leads, scoringConfig, deals, aiUsageLogs, openTasks };
    }
  );

  const wallet = await withOrgScope(user.organizationId, (tx) =>
    tx.aiCreditWallet.findUnique({ where: { organizationId: user.organizationId } })
  );

  const thresholds = { hotAt: scoringConfig?.hotAt ?? 80, warmAt: scoringConfig?.warmAt ?? 60 };

  const stageCounts = leads.reduce<Record<string, number>>((acc, lead) => {
    acc[lead.stage] = (acc[lead.stage] ?? 0) + 1;
    return acc;
  }, {});

  const temperatureCounts = leads.reduce<Record<string, number>>((acc, lead) => {
    const temp = classifyTemperature(lead.leadScore, thresholds);
    acc[temp] = (acc[temp] ?? 0) + 1;
    return acc;
  }, {});

  const sourceCounts = leads.reduce<Record<string, number>>((acc, lead) => {
    const key = lead.source?.name ?? "manual";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const wonDeals = deals.filter((d) => d.wonAt != null);
  const revenue = wonDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
  const creditsUsed = aiUsageLogs.reduce((sum, l) => sum + l.creditsCharged, 0);

  const StatCard = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  );

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">Analytics</h2>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total leads" value={leads.length} />
        <StatCard label="Hot leads" value={temperatureCounts.hot ?? 0} />
        <StatCard label="Open handoffs" value={openTasks} />
        <StatCard label="Deals won" value={wonDeals.length} />
        <StatCard label="Revenue won" value={`$${revenue.toFixed(2)}`} />
        <StatCard label="AI credits used" value={creditsUsed} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-neutral-700">Leads by stage</p>
          <ul className="space-y-1 text-sm text-neutral-600">
            {Object.entries(stageCounts).map(([stage, count]) => (
              <li key={stage} className="flex justify-between"><span>{stage}</span><span>{count}</span></li>
            ))}
            {leads.length === 0 && <li className="text-neutral-400">No leads yet.</li>}
          </ul>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium text-neutral-700">Leads by source</p>
          <ul className="space-y-1 text-sm text-neutral-600">
            {Object.entries(sourceCounts).map(([source, count]) => (
              <li key={source} className="flex justify-between"><span>{source}</span><span>{count}</span></li>
            ))}
            {leads.length === 0 && <li className="text-neutral-400">No leads yet.</li>}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <p className="text-sm font-medium text-neutral-700">AI credit wallet (org-wide, shared across businesses)</p>
        <p className="mt-1 text-2xl font-semibold text-neutral-900">{wallet?.balance ?? 0} credits remaining</p>
      </div>
    </div>
  );
}
