import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { appBaseUrl } from "@/lib/base-url";
import { CaptureSetup } from "@/components/capture-setup";

export default async function CapturePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const key = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.intakeKey.findFirst({ where: { businessId } })
  );

  return (
    <CaptureSetup
      businessId={businessId}
      baseUrl={await appBaseUrl()}
      publicKey={key?.publicKey ?? null}
      canManage={["owner", "admin"].includes(user.role)}
    />
  );
}
