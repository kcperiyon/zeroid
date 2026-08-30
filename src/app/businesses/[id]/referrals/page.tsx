import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { ReferralStatusToggle } from "@/components/referral-status-toggle";

export default async function ReferralsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const referrals = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.referral.findMany({
      where: { businessId },
      include: { referrerLead: { select: { name: true, email: true, phone: true } } },
      orderBy: { createdAt: "desc" },
    })
  );

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Referrals</h2>
      <p className="mb-4 text-sm text-neutral-500">Logged from a lead's detail page after a referral ask.</p>
      <div className="space-y-2">
        {referrals.length === 0 && <p className="text-sm text-neutral-500">No referrals logged yet.</p>}
        {referrals.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4">
            <div>
              <p className="font-medium text-neutral-900">{r.referredName}</p>
              <p className="text-sm text-neutral-500">
                {r.referredContact ? `${r.referredContact} · ` : ""}
                referred by {r.referrerLead.name || r.referrerLead.email || r.referrerLead.phone}
              </p>
            </div>
            <ReferralStatusToggle businessId={businessId} referralId={r.id} status={r.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
