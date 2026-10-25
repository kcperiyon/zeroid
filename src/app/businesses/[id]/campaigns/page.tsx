import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { campaignStats } from "@/lib/email-campaigns/engine";
import { liveSendingEnabled, parseAllowList } from "@/lib/email-campaigns/guard";
import { SegmentFilterSchema, segmentWhere } from "@/lib/email-campaigns/segments";
import { Card, Notice, StatusBadge } from "@/components/campaigns/ui";
import { IdentityForm } from "@/components/campaigns/identity-form";
import { SegmentBuilder } from "@/components/campaigns/segment-builder";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const canManage = ["owner", "admin"].includes(user.role);
  const canCampaign = ["owner", "admin", "manager", "marketing"].includes(user.role);

  const { identities, segments, campaigns } = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const [identities, segmentRows, campaignRows] = await Promise.all([
      tx.sendingIdentity.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
      tx.segment.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } }),
      tx.campaign.findMany({ where: { businessId }, include: { segment: { select: { name: true } }, identity: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    const segments = await Promise.all(
      segmentRows.map(async (s) => ({ ...s, size: await tx.lead.count({ where: segmentWhere(businessId, SegmentFilterSchema.catch({}).parse(s.filter)) }) }))
    );
    const campaigns = await Promise.all(campaignRows.map(async (c) => ({ ...c, stats: await campaignStats(tx, c.id) })));
    return { identities, segments, campaigns };
  });

  const allowCount = parseAllowList().size;
  const live = liveSendingEnabled();

  return (
    <div className="space-y-6">
      {live ? (
        <Notice tone="warn">Live sending is switched on for this server. Identities that are not in sandbox mode can email real prospects.</Notice>
      ) : (
        <Notice tone="info">
          <strong>Sandbox mode.</strong> Campaign emails can only be delivered to {allowCount} allow-listed address{allowCount === 1 ? "" : "es"}; every other recipient is
          blocked by the server and shown as <em>skipped</em>. Real sending is switched off until a dedicated sending domain and server are set up.
        </Notice>
      )}

      <Card title="Campaigns">
        {canCampaign && (
          <div className="mb-4">
            <NewCampaignForm businessId={businessId} segments={segments.map((s) => ({ id: s.id, name: `${s.name} (${s.size})` }))} identities={identities.map((i) => ({ id: i.id, name: i.name }))} />
          </div>
        )}
        {campaigns.length === 0 ? (
          <p className="text-sm text-neutral-500">No campaigns yet. Add a sending identity and a segment, then create your first campaign.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => {
              const m = c.stats.messages as Record<string, number>;
              const e = c.stats.events as Record<string, number>;
              return (
                <Link key={c.id} href={`/businesses/${businessId}/campaigns/${c.id}`} className="block rounded-lg border border-neutral-200 p-3 hover:border-neutral-400 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-neutral-900">{c.name}</p>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">Segment: {c.segment.name} · From: {c.identity.name}</p>
                  <p className="mt-2 text-xs text-neutral-600">
                    {m.scheduled ?? 0} queued · {m.sent ?? 0} sent · {e.opened ?? 0} opened · {e.clicked ?? 0} clicked · {e.replied ?? 0} replied · {e.bounced ?? 0} bounced · {e.unsubscribed ?? 0} unsubscribed
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Segments (who to email)">
        {canCampaign && (
          <div className="mb-4">
            <SegmentBuilder businessId={businessId} />
          </div>
        )}
        {segments.length === 0 ? (
          <p className="text-sm text-neutral-500">A segment is a saved filter over your leads, for example &ldquo;leads from news triggers in the Hot stage&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {segments.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="font-medium text-neutral-800">{s.name}</span>
                <span className="text-neutral-500">{s.size} lead{s.size === 1 ? "" : "s"} with an email</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Sending identities (who it comes from)">
        <div className="mb-4">
          <IdentityForm businessId={businessId} canManage={canManage} />
        </div>
        {identities.length === 0 ? (
          <p className="text-sm text-neutral-500">No sending identity yet. It holds the from-address, the postal address shown in every email, daily limits and (later) your own mail server.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {identities.map((i) => (
              <li key={i.id} className="py-2">
                <p className="font-medium text-neutral-800">{i.name} <span className="font-normal text-neutral-500">— {i.fromName} &lt;{i.fromEmail}&gt;</span></p>
                <p className="text-xs text-neutral-500">
                  {i.provider === "brevo_shared" ? "Shared Brevo (testing only)" : `Own SMTP (${i.smtpHost})`} · {i.dailyCap}/day cap · {i.sandboxOnly || i.provider === "brevo_shared" ? "sandbox" : "live-enabled"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
