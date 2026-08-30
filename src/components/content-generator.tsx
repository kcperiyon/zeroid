"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const PURPOSES = [
  "awareness", "problem_identification", "education", "authority",
  "trust", "objection_handling", "lead_capture", "conversion",
] as const;

export function ContentGenerator({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState<string>("awareness");
  const [channel, setChannel] = useState("linkedin");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/businesses/${businessId}/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, channel, extraInstructions: extraInstructions || undefined }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setExtraInstructions("");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">
        Drafts only — nothing is auto-posted anywhere. Requires ANTHROPIC_API_KEY to be configured.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="content-purpose" className="text-sm font-medium text-neutral-700">Purpose</label>
          <select
            id="content-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          >
            {PURPOSES.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="content-channel" className="text-sm font-medium text-neutral-700">Channel</label>
          <input
            id="content-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="content-extra" className="text-sm font-medium text-neutral-700">Extra instructions (optional)</label>
        <textarea
          id="content-extra"
          rows={2}
          value={extraInstructions}
          onChange={(e) => setExtraInstructions(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate draft"}
      </button>
    </form>
  );
}
