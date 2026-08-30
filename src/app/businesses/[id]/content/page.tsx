import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { ContentGenerator } from "@/components/content-generator";
import { ContentStatusToggle } from "@/components/content-status-toggle";

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const contentItems = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.contentItem.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } })
  );

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Content studio</h2>

      <ContentGenerator businessId={businessId} />

      <div className="space-y-3">
        {contentItems.length === 0 && <p className="text-sm text-neutral-500">No content drafted yet.</p>}
        {contentItems.map((item) => (
          <div key={item.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-neutral-500">
                {item.channel} · {item.purpose.replace(/_/g, " ")}
              </span>
              <ContentStatusToggle businessId={businessId} contentId={item.id} status={item.status} />
            </div>
            <p className="whitespace-pre-wrap text-sm text-neutral-800">{item.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
