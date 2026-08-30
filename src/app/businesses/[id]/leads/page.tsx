import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { classifyTemperature } from "@/lib/scoring";
import { CreateLeadForm } from "@/components/create-lead-form";
import { ImportLeadsForm } from "@/components/import-leads-form";

const TEMPERATURE_STYLES: Record<string, string> = {
  hot: "bg-red-100 text-red-700",
  warm: "bg-amber-100 text-amber-700",
  cold: "bg-blue-100 text-blue-700",
  unscored: "bg-neutral-100 text-neutral-500",
};

export default async function LeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const { leads, scoringConfig } = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const [leads, scoringConfig] = await Promise.all([
      tx.lead.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } }),
      tx.scoringConfig.findUnique({ where: { businessId } }),
    ]);
    return { leads, scoringConfig };
  });

  const thresholds = { hotAt: scoringConfig?.hotAt ?? 80, warmAt: scoringConfig?.warmAt ?? 60 };

  const stageCounts = leads.reduce<Record<string, number>>((acc, lead) => {
    acc[lead.stage] = (acc[lead.stage] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Leads</h2>

      {leads.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-neutral-500">
          {Object.entries(stageCounts).map(([stage, count]) => (
            <span key={stage} className="rounded-full bg-neutral-100 px-2 py-1">
              {stage}: {count}
            </span>
          ))}
        </div>
      )}

      <div className="mb-6 space-y-2">
        {leads.length === 0 && (
          <p className="text-sm text-neutral-500">No leads yet — add one manually or import a CSV below.</p>
        )}
        {leads.map((lead) => {
          const temperature = classifyTemperature(lead.leadScore, thresholds);
          return (
            <Link
              key={lead.id}
              href={`/businesses/${businessId}/leads/${lead.id}`}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-400"
            >
              <div>
                <p className="font-medium text-neutral-900">{lead.name || lead.email || lead.phone || "Unnamed lead"}</p>
                <p className="text-sm text-neutral-500">
                  {lead.company ? `${lead.company} · ` : ""}{lead.stage}
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${TEMPERATURE_STYLES[temperature]}`}>
                {lead.leadScore != null ? `${lead.leadScore} · ${temperature}` : "unscored"}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <CreateLeadForm businessId={businessId} />
        <ImportLeadsForm businessId={businessId} />
      </div>
    </div>
  );
}
