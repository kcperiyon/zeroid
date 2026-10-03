import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withOrgScope } from "@/lib/tenant-db";
import { CreateBusinessForm } from "@/components/create-business-form";

export default async function BusinessesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const businesses = await withOrgScope(user.organizationId, (tx) =>
    tx.business.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
    })
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Businesses</h1>
        <p className="mt-1 text-sm text-neutral-500">Signed in as {user.email} · {user.role}</p>
      </div>

      <div className="mb-6 space-y-3">
        {businesses.length === 0 && (
          <p className="text-sm text-neutral-500">No businesses yet — create your first one below.</p>
        )}
        {businesses.map((business) => (
          <Link
            key={business.id}
            href={`/businesses/${business.id}`}
            className="block rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-400"
          >
            <p className="font-medium text-neutral-900">{business.name}</p>
            {business.industry && <p className="text-sm text-neutral-500">{business.industry}</p>}
          </Link>
        ))}
      </div>

      <CreateBusinessForm />
    </main>
  );
}
