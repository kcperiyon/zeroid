import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg } from "@/lib/tenant-db";
import { BusinessTabs } from "@/components/business-tabs";

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
    { href: `/businesses/${businessId}/prospecting`, label: "Prospecting" },
    { href: `/businesses/${businessId}/capture`, label: "Capture" },
    { href: `/businesses/${businessId}/social`, label: "Social" },
    { href: `/businesses/${businessId}/icp`, label: "ICP" },
    { href: `/businesses/${businessId}/knowledge`, label: "Train AI" },
    { href: `/businesses/${businessId}/whatsapp`, label: "WhatsApp" },
    { href: `/businesses/${businessId}/content`, label: "Content" },
    { href: `/businesses/${businessId}/referrals`, label: "Referrals" },
    { href: `/businesses/${businessId}/handoff`, label: "Handoff" },
    { href: `/businesses/${businessId}/analytics`, label: "Analytics" },
    { href: `/businesses/${businessId}/insights`, label: "Insights" },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link href="/businesses" className="text-sm text-neutral-500 hover:text-neutral-900">← All businesses</Link>

      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{business.name}</h1>
        {business.industry && <p className="mt-1 text-sm text-neutral-500">{business.industry}</p>}
      </div>

      <BusinessTabs tabs={tabs} baseHref={`/businesses/${businessId}`} />

      {children}
    </main>
  );
}
