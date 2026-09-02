"use client";

import { useState, type FormEvent } from "react";

export function PurchaseCreditsForm() {
  const [amountUsd, setAmountUsd] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/billing/credits/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountUsd: Number(amountUsd) }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));

    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    // Real Flutterwave hosted checkout — leaving this page for real.
    window.location.href = body.checkoutUrl;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="amountUsd" className="text-xs text-neutral-500">Amount (USD)</label>
        <input
          id="amountUsd"
          type="number"
          min={1}
          max={1000}
          step="1"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          className="w-24 rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? "Redirecting…" : "Purchase credits"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
