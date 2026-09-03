import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { ProspectingPanel } from "@/components/prospecting-panel";

export default async function ProspectingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const [icpProfiles, prospects] = await withBusinessScope(user.organizationId, businessId, (tx) =>
    Promise.all([
      tx.icpProfile.findMany({ where: { businessId, isActive: true }, orderBy: { createdAt: "asc" } }),
      tx.prospect.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } }),
    ])
  );

  return (
    <ProspectingPanel
      businessId={businessId}
      icpProfiles={icpProfiles.map((p) => ({
        id: p.id,
        name: p.name,
        attributes: p.attributes as Record<string, string | undefined>,
      }))}
      prospects={prospects.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
    />
  );
}
