import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { campaignStats } from "@/lib/email-campaigns/engine";
import { liveSendingEnabled, parseAllowList } from "@/lib/email-campaigns/guard";
import { SegmentFilterSchema, segmentWhere } from "@/lib/email-campaigns/segments";
import { publicIdentity } from "@/lib/email-campaigns/identity-schema";
import { Card, Notice, StatusBadge } from "@/components/campaigns/ui";
import { IdentityForm } from "@/components/campaigns/identity-form";
import { IdentityCard } from "@/components/campaigns/identity-card";
import { SegmentBuilder } from "@/components/campaigns/segment-builder";
import { SegmentRow } from "@/components/campaigns/segment-row";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";
import { SuppressionList } from "@/components/campaigns/suppression-list";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const isOwner = user.role === "owner";
  const canManage = ["owner", "admin"].includes(user.role);
  const canCampaign = ["owner", "admin", "manager", "marketing"].includes(user.role);

  // Sequential on purpose: queries inside one transaction must not overlap.
  const data = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const identities = await tx.sendingIdentity.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
    const segmentRows = await tx.segment.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
    const campaignRows = await tx.campaign.findMany({
      where: { businessId },
      include: { segment: { select: { name: true } }, identity: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    const segments = [];
    for (const s of segmentRows) {
      const filter = SegmentFilterSchema.catch({}).parse(s.filter);
      segments.push({ id: s.id, name: s.name, filter, size: await tx.lead.count({ where: segmentWhere(businessId, filter) }) });
    }
    const campaigns = [];
    for (const c of campaignRows) campaigns.push({ ...c, stats: await campaignStats(tx, c.id) });
    const suppressions = await tx.suppression.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 200 });
    const platformWideCount = await tx.suppression.count({ where: { businessId: null } });
    return { identities, segments, campaigns, suppressions, platformWideCount };
  });
  const { identities, segments, campaigns, suppressions, platformWideCount } = data;

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
          <ul className="divide-y divide-neutral-100">
            {segments.map((s) => (
              <SegmentRow key={s.id} businessId={businessId} segment={s} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Sending identities (who it comes from)">
        <div className="mb-4">
          <IdentityForm businessId={businessId} canManage={canManage} />
        </div>
        {identities.length === 0 ? (
          <p className="text-sm text-neutral-500">No sending identity yet. It holds the from-address, the postal address shown in every email, daily limits, your own mail server and the inbox replies are read from.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {identities.map((i) => {
              const p = publicIdentity(i);
              return (
                <IdentityCard
                  key={i.id}
                  businessId={businessId}
                  canManage={canManage}
                  isOwner={isOwner}
                  identity={{
                    id: p.id, name: p.name, provider: p.provider, fromEmail: p.fromEmail, fromName: p.fromName, replyToEmail: p.replyToEmail,
                    physicalAddress: p.physicalAddress, smtpHost: p.smtpHost, smtpPort: p.smtpPort, smtpSecure: p.smtpSecure, smtpUser: p.smtpUser,
                    dkimDomain: p.dkimDomain, dkimSelector: p.dkimSelector, imapHost: p.imapHost, imapPort: p.imapPort, imapSecure: p.imapSecure,
                    imapUser: p.imapUser, imapFolder: p.imapFolder, dailyCap: p.dailyCap, perDomainHourlyCap: p.perDomainHourlyCap,
                    hasSmtpPassword: p.hasSmtpPassword, hasDkimKey: p.hasDkimKey, hasImapPassword: p.hasImapPassword,
                    sandboxOnly: p.sandboxOnly, active: p.active, imapLastError: p.imapLastError,
                    imapLastCheckAt: p.imapLastCheckAt ? p.imapLastCheckAt.toISOString() : null,
                  }}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Do-not-email list">
        <SuppressionList
          businessId={businessId}
          platformWideCount={platformWideCount}
          entries={suppressions.map((s) => ({ id: s.id, email: s.email, reason: s.reason, createdAt: s.createdAt.toISOString() }))}
        />
      </Card>
    </div>
  );
}
