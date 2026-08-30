"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const STAGES = [
  "new", "contacted", "engaged", "qualified", "hot", "appointment",
  "proposal", "negotiation", "won", "lost", "nurture",
] as const;

const FACTORS = [
  { key: "icpScore", label: "ICP fit" },
  { key: "problemSeverity", label: "Problem severity" },
  { key: "purchaseIntent", label: "Purchase intent" },
  { key: "budgetFit", label: "Budget fit" },
  { key: "urgency", label: "Urgency" },
  { key: "engagement", label: "Engagement" },
  { key: "decisionAuthority", label: "Decision authority" },
] as const;

type FactorKey = (typeof FACTORS)[number]["key"];

interface LeadEditorProps {
  businessId: string;
  leadId: string;
  stage: string;
  leadScore: number | null;
  factors: Record<FactorKey, number | null>;
}

export function LeadEditor({ businessId, leadId, stage, leadScore, factors }: LeadEditorProps) {
  const router = useRouter();
  const [values, setValues] = useState(factors);
  const [currentStage, setCurrentStage] = useState(stage);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [rationale, setRationale] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  async function submit(patch: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/businesses/${businessId}/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }
    setLoading(false);
    router.refresh();
  }

  async function handleStageChange(next: string) {
    setCurrentStage(next);
    await submit({ stage: next });
  }

  async function handleFactorsSubmit(event: FormEvent) {
    event.preventDefault();
    await submit(values);
  }

  async function handleSuggest() {
    if (!notes.trim()) {
      setSuggestError("Describe what you know about this lead first.");
      return;
    }
    setSuggesting(true);
    setSuggestError(null);
    setRationale(null);

    const res = await fetch(`/api/businesses/${businessId}/leads/${leadId}/qualify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));

    if (!res.ok) {
      setSuggestError(body.error ?? "Something went wrong.");
      setSuggesting(false);
      return;
    }

    const { rationale: why, ...suggestedFactors } = body.suggestion;
    setValues((prev) => ({ ...prev, ...suggestedFactors }));
    setRationale(why);
    setSuggesting(false);
  }

  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <label htmlFor="stage" className="mr-2 text-sm font-medium text-neutral-700">Stage</label>
          <select
            id="stage"
            value={currentStage}
            onChange={(e) => handleStageChange(e.target.value)}
            disabled={loading}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <p className="text-sm text-neutral-500">Score: <span className="font-medium text-neutral-900">{leadScore ?? "—"}</span></p>
      </div>

      <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <label htmlFor="lead-notes" className="text-sm font-medium text-neutral-700">
          What do you know about this lead? (AI Suggest)
        </label>
        <textarea
          id="lead-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Runs a 6-person coaching business, said cash flow is inconsistent month to month, wants to start within 2 weeks, she's the sole decision maker."
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {suggesting ? "Thinking…" : "Suggest factors with AI"}
        </button>
        {suggestError && <p className="text-sm text-red-600">{suggestError}</p>}
        {rationale && (
          <p className="text-xs text-neutral-500">
            AI's reasoning: {rationale} — review the numbers below, then Save factors if you agree.
          </p>
        )}
      </div>

      <form onSubmit={handleFactorsSubmit} className="space-y-3">
        <p className="text-xs text-neutral-500">
          Qualification factors (0-100) — AI-suggested or set manually, either way you confirm by saving.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {FACTORS.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <label htmlFor={key} className="text-sm font-medium text-neutral-700">{label}</label>
              <input
                id={key}
                type="number"
                min={0}
                max={100}
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [key]: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Save factors"}
        </button>
      </form>
    </div>
  );
}
