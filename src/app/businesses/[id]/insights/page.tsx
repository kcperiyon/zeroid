import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { attributionByChannel, predictWinProbabilities, type InsightLead } from "@/lib/insights";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: businessId } = await params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) notFound();

  const rows = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.lead.findMany({
      where: { businessId },
      select: { id: true, name: true, company: true, stage: true, leadScore: true, source: { select: { channel: true } } },
    })
  );

  const leads: InsightLead[] = rows.map((l) => ({
    id: l.id,
    stage: l.stage,
    channel: l.source?.channel ?? "manual",
    leadScore: l.leadScore,
  }));
  const channels = attributionByChannel(leads);
  const prediction = predictWinProbabilities(leads);

  const openRanked = prediction.ready
    ? rows
        .filter((l) => prediction.byLead.has(l.id))
        .map((l) => ({ ...l, p: prediction.byLead.get(l.id)! }))
        .sort((a, b) => b.p - a.p)
        .slice(0, 15)
    : [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Where leads come from</h2>
        {channels.length === 0 ? (
          <p className="text-sm text-neutral-500">No leads yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Channel</th><th className="px-3 py-2">Leads</th><th className="px-3 py-2">Won</th>
                  <th className="px-3 py-2">Lost</th><th className="px-3 py-2">Open</th><th className="px-3 py-2">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.channel} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-medium text-neutral-900">{c.channel}</td>
                    <td className="px-3 py-2">{c.leads}</td>
                    <td className="px-3 py-2">{c.won}</td>
                    <td className="px-3 py-2">{c.lost}</td>
                    <td className="px-3 py-2">{c.open}</td>
                    <td className="px-3 py-2">{c.winRate == null ? "—" : `${Math.round(c.winRate * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-400">
          First-touch attribution: each lead is credited to the channel it was created from. Zeroid doesn&apos;t record a
          touchpoint history yet, so multi-touch attribution isn&apos;t possible, and deal revenue isn&apos;t captured —
          win rate is won ÷ (won + lost), counts only, not money.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Likely to close</h2>
        {!prediction.ready ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
            Not enough history to predict yet — {prediction.closedCount} of {prediction.needed} closed (won or lost) leads.
            Zeroid won&apos;t guess before it has real outcomes to learn from. Mark leads won or lost as they resolve.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-neutral-500">
              Learned from {prediction.closedCount} closed leads (overall win rate {Math.round(prediction.baseRate * 100)}%).
            </p>
            <div className="space-y-2">
              {openRanked.length === 0 && <p className="text-sm text-neutral-500">No open leads to rank.</p>}
              {openRanked.map((l) => (
                <Link
                  key={l.id}
                  href={`/businesses/${businessId}/leads/${l.id}`}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  <span className="text-neutral-900">{l.name ?? l.company ?? "Unnamed lead"} <span className="text-neutral-400">· {l.stage}</span></span>
                  <span className="font-medium text-neutral-700">{Math.round(l.p * 100)}%</span>
                </Link>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              A simple model: each channel&apos;s and score band&apos;s historical win rate, shrunk toward the overall rate so small
              samples can&apos;t claim certainty. It ranks leads; it isn&apos;t a promise.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
