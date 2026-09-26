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

  const [steps, setSteps] = useState<{ dayOffset: number; intent: string; message: string }[] | null>(null);
  const [seqLoading, setSeqLoading] = useState(false);
  const [seqError, setSeqError] = useState<string | null>(null);
  const [scheduledCount, setScheduledCount] = useState<number | null>(null);

  async function handlePlanSequence() {
    setSeqLoading(true);
    setSeqError(null);
    setSteps(null);
    setScheduledCount(null);
    const res = await fetch(`/api/businesses/${businessId}/leads/${leadId}/follow-up-sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ situation }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));
    if (!res.ok) setSeqError(body.error ?? "Something went wrong.");
    else setSteps(body.steps);
    setSeqLoading(false);
  }

  async function handleSchedule() {
    if (!steps) return;
    setSeqLoading(true);
    setSeqError(null);
    const res = await fetch(`/api/businesses/${businessId}/leads/${leadId}/follow-up-sequence/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ situation, steps: steps.map((s) => ({ dayOffset: s.dayOffset, message: s.message })) }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));
    if (!res.ok) setSeqError(body.error ?? "Something went wrong.");
    else {
      setScheduledCount(body.scheduled);
      setSteps(null);
      router.refresh();
    }
    setSeqLoading(false);
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

      <div className="mt-3 border-t border-neutral-100 pt-3">
        <button
          onClick={handlePlanSequence}
          disabled={seqLoading}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {seqLoading ? "Planning…" : "Plan a multi-step sequence"}
        </button>
        {seqError && <p className="mt-2 text-sm text-red-600">{seqError}</p>}
        {scheduledCount !== null && (
          <p className="mt-2 text-sm text-green-700">{scheduledCount} tasks scheduled — find them on the Handoff tab.</p>
        )}
        {steps && (
          <div className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <div key={i}>
                <p className="text-xs text-neutral-500">Step {i + 1} · day {s.dayOffset} · {s.intent}</p>
                <textarea
                  value={s.message}
                  rows={2}
                  onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)))}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </div>
            ))}
            <button
              onClick={handleSchedule}
              disabled={seqLoading}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Schedule as tasks
            </button>
            <p className="text-xs text-neutral-400">Each step becomes a dated task for you to send — nothing is sent automatically.</p>
          </div>
        )}
      </div>
    </div>
  );
}
