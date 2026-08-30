import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { TaskList } from "@/components/task-list";

export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const tasks = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.task.findMany({
      where: { businessId, status: "open" },
      include: { lead: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { createdAt: "desc" },
    })
  );

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Handoff</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Leads a rep needs to act on now — created automatically when a lead is marked HOT.
      </p>
      <TaskList
        businessId={businessId}
        tasks={tasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
      />
    </div>
  );
}
