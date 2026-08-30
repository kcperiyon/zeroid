import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";

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

  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

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
        <button
          disabled={!stripeConfigured}
          title={stripeConfigured ? undefined : "Billing isn't wired to a live Stripe account yet."}
          className="mt-3 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Purchase credits
        </button>
        {!stripeConfigured && (
          <p className="mt-2 text-xs text-neutral-400">
            Purchasing is disabled until STRIPE_SECRET_KEY is configured — see docs/build-spec.md §9.
          </p>
        )}
      </div>
    </main>
  );
}
