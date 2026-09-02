import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";
import { PurchaseCreditsForm } from "@/components/purchase-credits-form";

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { subscription, wallet } = await withOrgScope(user.organizationId, async (tx) => {
    const [subscription, wallet] = await Promise.all([
      tx.subscription.findUnique({ where: { organizationId: user.organizationId } }),
      tx.aiCreditWallet.findUnique({ where: { organizationId: user.organizationId } }),
    ]);
    return { subscription, wallet };
  });

  // Flutterwave, not Stripe — corrected 2026-08-30 (see build-spec.md §13).
  // Live since the account-wide key rotation — see
  // [[flutterwave-shared-account-rotation]] memory for why this key is
  // shared with Mongozutu/Flux9 and must never be rotated from here alone.
  const flutterwaveConfigured = Boolean(process.env.FLUTTERWAVE_SECRET_KEY);
  const canPurchase = ["owner", "admin"].includes(user.role);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/businesses" className="text-sm text-neutral-500 hover:text-neutral-900">← Businesses</Link>

      <h1 className="mt-4 mb-6 text-xl font-semibold text-neutral-900">Billing</h1>

      <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4">
        <p className="text-sm font-medium text-neutral-700">Plan</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900 capitalize">
          {subscription?.plan ?? "solo"} · {subscription?.status ?? "trialing"}
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4">
        <p className="text-sm font-medium text-neutral-700">AI credits</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900">{wallet?.balance ?? 0} remaining</p>

        {flutterwaveConfigured && canPurchase && <PurchaseCreditsForm />}

        {!flutterwaveConfigured && (
          <p className="mt-2 text-xs text-neutral-400">
            Purchasing is disabled until FLUTTERWAVE_SECRET_KEY is configured for Zeroid — see docs/build-spec.md §13.
          </p>
        )}
        {flutterwaveConfigured && !canPurchase && (
          <p className="mt-2 text-xs text-neutral-400">Only owners and admins can purchase credits.</p>
        )}
      </div>
    </main>
  );
}
