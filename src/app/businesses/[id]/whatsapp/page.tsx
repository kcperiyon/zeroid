import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { WhatsAppConnectForm } from "@/components/whatsapp-connect-form";

export default async function WhatsAppPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const connection = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.whatsAppConnection.findFirst({ where: { businessId } })
  );

  return (
    <WhatsAppConnectForm
      businessId={businessId}
      connected={
        connection
          ? {
              phoneNumberId: connection.phoneNumberId,
              wabaId: connection.wabaId,
              displayPhoneNumber: connection.displayPhoneNumber,
              accessTokenMasked: `••••${connection.accessToken.slice(-4)}`,
            }
          : null
      }
    />
  );
}
