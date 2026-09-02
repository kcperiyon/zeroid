import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg } from "@/lib/tenant-db";

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const tabs = [
    { href: `/businesses/${businessId}`, label: "Products" },
    { href: `/businesses/${businessId}/leads`, label: "Leads" },
    { href: `/businesses/${businessId}/icp`, label: "ICP" },
    { href: `/businesses/${businessId}/knowledge`, label: "Train AI" },
    { href: `/businesses/${businessId}/content`, label: "Content" },
    { href: `/businesses/${businessId}/referrals`, label: "Referrals" },
    { href: `/businesses/${businessId}/handoff`, label: "Handoff" },
    { href: `/businesses/${businessId}/analytics`, label: "Analytics" },
  ];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/businesses" className="text-sm text-neutral-500 hover:text-neutral-900">← All businesses</Link>

      <div className="mt-4 mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">{business.name}</h1>
        {business.industry && <p className="mt-1 text-sm text-neutral-500">{business.industry}</p>}
      </div>

      <nav className="mb-6 flex gap-4 border-b border-neutral-200">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="pb-2 text-sm font-medium text-neutral-600 hover:text-neutral-900"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </main>
  );
}
