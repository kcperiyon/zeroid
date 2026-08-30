import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { CreateIcpForm } from "@/components/create-icp-form";

export default async function IcpPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const icpProfiles = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.icpProfile.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } })
  );

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Ideal Customer Profiles</h2>
      <div className="mb-6 space-y-3">
        {icpProfiles.length === 0 && (
          <p className="text-sm text-neutral-500">No ICP defined yet — describe your ideal customer below.</p>
        )}
        {icpProfiles.map((icp) => {
          const attrs = icp.attributes as Record<string, string | undefined>;
          return (
            <div key={icp.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="font-medium text-neutral-900">{icp.name}</p>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-sm text-neutral-600">
                {attrs.industry && <div><dt className="inline text-neutral-400">Industry: </dt><dd className="inline">{attrs.industry}</dd></div>}
                {attrs.location && <div><dt className="inline text-neutral-400">Location: </dt><dd className="inline">{attrs.location}</dd></div>}
                {attrs.companySize && <div><dt className="inline text-neutral-400">Company size: </dt><dd className="inline">{attrs.companySize}</dd></div>}
                {attrs.budget && <div><dt className="inline text-neutral-400">Budget: </dt><dd className="inline">{attrs.budget}</dd></div>}
              </dl>
              {attrs.problems && <p className="mt-2 text-sm text-neutral-500">{attrs.problems}</p>}
            </div>
          );
        })}
      </div>

      <CreateIcpForm businessId={businessId} />
    </div>
  );
}
