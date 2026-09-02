import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { TrainAiPanel } from "@/components/train-ai-panel";

export default async function KnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const sources = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.knowledgeSource.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } })
  );

  return (
    <TrainAiPanel
      businessId={businessId}
      sources={sources.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))}
    />
  );
}
