"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FOLLOW_UP_SITUATIONS } from "@/lib/follow-up-situations";

export function FollowUpDraft({ businessId, leadId }: { businessId: string; leadId: string }) {
  const router = useRouter();
  const [situation, setSituation] = useState<string>(FOLLOW_UP_SITUATIONS[0].value);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleDraft() {
    setLoading(true);
    setError(null);
    setDraft(null);

    const res = await fetch(`/api/businesses/${businessId}/leads/${leadId}/follow-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ situation }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setDraft(body.draft);
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-700">AI follow-up draft</p>
        <div className="flex items-center gap-2">
          <select
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            {FOLLOW_UP_SITUATIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={handleDraft}
            disabled={loading}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Drafting…" : "Draft message"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        Drafts only — you review and send it yourself. Requires ANTHROPIC_API_KEY to be configured.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {draft && <p className="mt-2 rounded-md bg-neutral-50 p-3 text-sm text-neutral-800">{draft}</p>}
    </div>
  );
}
