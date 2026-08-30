"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function ImportLeadsForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const res = await fetch(`/api/businesses/${businessId}/leads/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });

    const resBody = await res.json().catch(() => ({ error: "Something went wrong." }));
    if (!res.ok) {
      setError(resBody.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setResult(`Imported ${resBody.created} lead${resBody.created === 1 ? "" : "s"}${resBody.skipped ? ` (${resBody.skipped} skipped, no usable contact info)` : ""}.`);
    setCsv("");
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
      >
        Import CSV
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="space-y-1">
        <label htmlFor="csv-text" className="text-sm font-medium text-neutral-700">
          Paste CSV (header row required: name, email, phone, company)
        </label>
        <textarea
          id="csv-text"
          required
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"name,email,phone,company\nJohn Ade,john@example.com,+2348..,Acme Ltd"}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-neutral-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && <p className="text-sm text-green-700">{result}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Close
        </button>
      </div>
    </form>
  );
}
