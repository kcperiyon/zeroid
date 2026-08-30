"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function BookAppointmentForm({ businessId, leadId }: { businessId: string; leadId: string }) {
  const router = useRouter();
  const [startAt, setStartAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/businesses/${businessId}/leads/${leadId}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt: new Date(startAt).toISOString(), notes: notes || undefined }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setStartAt("");
    setNotes("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
      >
        Book appointment
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-xs text-neutral-500">Manual/internal only — no calendar sync yet.</p>
      <input
        type="datetime-local"
        required
        value={startAt}
        onChange={(e) => setStartAt(e.target.value)}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
      <input
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
          {loading ? "Booking…" : "Book"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
