import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { isGooglePlacesConfigured } from "@/lib/prospecting/google-places";
import { listJobsWithCounts } from "@/lib/discovery/jobs-view";
import { DiscoveryPanel } from "@/components/discovery/discovery-panel";

export default async function DiscoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const jobs = await withBusinessScope(user.organizationId, businessId, (tx) => listJobsWithCounts(tx, businessId));
  const canRun = ["owner", "admin", "manager", "marketing"].includes(user.role);
  const canImport = ["owner", "admin", "manager"].includes(user.role);
  return (
    <DiscoveryPanel
      businessId={businessId}
      canRun={canRun}
      canImport={canImport}
      placesConfigured={isGooglePlacesConfigured()}
      initialJobs={JSON.parse(JSON.stringify(jobs))}
    />
  );
}
