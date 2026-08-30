import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { LeadEditor } from "@/components/lead-editor";
import { FollowUpDraft } from "@/components/follow-up-draft";
import { BookAppointmentForm } from "@/components/book-appointment-form";
import { LogReferralForm } from "@/components/log-referral-form";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string; leadId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId, leadId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const lead = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.lead.findFirst({
      where: { id: leadId, businessId },
      include: { events: { orderBy: { createdAt: "desc" } } },
    })
  );
  if (!lead) notFound();

  return (
    <div>
      <Link href={`/businesses/${businessId}/leads`} className="text-sm text-neutral-500 hover:text-neutral-900">
        ← All leads
      </Link>

      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-neutral-900">
          {lead.name || lead.email || lead.phone || "Unnamed lead"}
        </h2>
        <p className="text-sm text-neutral-500">
          {[lead.company, lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact details"}
        </p>
      </div>

      <div className="mb-6">
        <LeadEditor
          businessId={businessId}
          leadId={lead.id}
          stage={lead.stage}
          leadScore={lead.leadScore}
          factors={{
            icpScore: lead.icpScore,
            problemSeverity: lead.problemSeverity,
            purchaseIntent: lead.purchaseIntent,
            budgetFit: lead.budgetFit,
            urgency: lead.urgency,
            engagement: lead.engagement,
            decisionAuthority: lead.decisionAuthority,
          }}
        />
      </div>

      <div className="mb-6">
        <FollowUpDraft businessId={businessId} leadId={lead.id} />
      </div>

      <div className="mb-6 flex gap-2">
        <BookAppointmentForm businessId={businessId} leadId={lead.id} />
        <LogReferralForm businessId={businessId} leadId={lead.id} />
      </div>

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Timeline</h3>
      <div className="space-y-2">
        {lead.events.length === 0 && <p className="text-sm text-neutral-500">No activity yet.</p>}
        {lead.events.map((event) => (
          <div key={event.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <p className="font-medium text-neutral-800">{event.type.replace(/_/g, " ")}</p>
            <p className="text-xs text-neutral-500">{new Date(event.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
