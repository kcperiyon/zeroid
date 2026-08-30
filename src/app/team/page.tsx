import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";
import { InviteMemberForm } from "@/components/invite-member-form";

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { members, invites } = await withOrgScope(user.organizationId, async (tx) => {
    const [members, invites] = await Promise.all([
      tx.orgMembership.findMany({
        where: { organizationId: user.organizationId },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      }),
      tx.invite.findMany({
        where: { organizationId: user.organizationId, status: "pending" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { members, invites };
  });

  const canInvite = ["owner", "admin"].includes(user.role);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/businesses" className="text-sm text-neutral-500 hover:text-neutral-900">← Businesses</Link>

      <h1 className="mt-4 mb-6 text-xl font-semibold text-neutral-900">Team</h1>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Members</h2>
      <div className="mb-6 space-y-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4">
            <div>
              <p className="font-medium text-neutral-900">{m.user.name}</p>
              <p className="text-sm text-neutral-500">{m.user.email}</p>
            </div>
            <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-600">{m.role}</span>
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Pending invites</h2>
          <div className="mb-6 space-y-2">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-dashed border-neutral-300 bg-white p-4">
                <p className="text-sm text-neutral-700">{i.email}</p>
                <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-600">{i.role}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {canInvite && <InviteMemberForm />}
    </main>
  );
}
