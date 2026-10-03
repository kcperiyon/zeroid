import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { appBaseUrl } from "@/lib/base-url";
import { MetaConnectForm } from "@/components/meta-connect-form";

export default async function SocialPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const connection = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.metaConnection.findFirst({ where: { businessId } })
  );

  return (
    <MetaConnectForm
      businessId={businessId}
      webhookUrl={`${await appBaseUrl()}/api/webhooks/meta`}
      canManage={["owner", "admin"].includes(user.role)}
      connected={
        connection
          ? {
              pageId: connection.pageId,
              pageName: connection.pageName,
              instagramLinked: Boolean(connection.instagramAccountId),
              subscribed: connection.subscribed,
              tokenMasked: `••••${connection.pageAccessToken.slice(-4)}`,
            }
          : null
      }
    />
  );
}
