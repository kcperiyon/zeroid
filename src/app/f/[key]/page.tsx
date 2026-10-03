import { notFound } from "next/navigation";
import { withBusinessScope, withIntakeKeyScope } from "@/lib/tenant-db";
import { BrandMark } from "@/components/brand-mark";
import { CaptureForm } from "@/components/capture-form";

/** Public, hosted lead-capture form -- share the link or embed it as an iframe. */
export default async function HostedFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ utm_campaign?: string; utm_medium?: string }>;
}) {
  const { key } = await params;
  const sp = await searchParams;

  const owner = await withIntakeKeyScope(key, (tx) => tx.intakeKey.findFirst({ where: { publicKey: key } }));
  if (!owner) notFound();
  const business = await withBusinessScope(owner.organizationId, owner.businessId, (tx) =>
    tx.business.findFirst({ where: { id: owner.businessId } })
  );
  if (!business) notFound();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <BrandMark className="h-8 w-8" />
        <span className="text-lg font-semibold tracking-tight text-neutral-900">{business.name}</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Get in touch</h1>
      <p className="mt-1 mb-6 text-sm text-neutral-500">Leave your details and we&apos;ll reach out.</p>
      <CaptureForm publicKey={key} utmCampaign={sp.utm_campaign} utmMedium={sp.utm_medium} />
    </main>
  );
}
