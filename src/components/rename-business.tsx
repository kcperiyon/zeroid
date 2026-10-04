"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function RenameBusiness({ businessId, name, industry }: { businessId: string; name: string; industry: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [industryValue, setIndustryValue] = useState(industry ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/businesses/${businessId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: value, industry: industryValue }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setError(body.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-neutral-500 hover:text-neutral-900">
        Edit name
      </button>
    );
  }

  const input =
    "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
  return (
    <form onSubmit={handleSubmit} className="mt-3 max-w-md space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="space-y-1">
        <label htmlFor="biz-name" className="text-sm font-medium text-neutral-700">Business name</label>
        <input id="biz-name" required value={value} onChange={(e) => setValue(e.target.value)} className={input} />
      </div>
      <div className="space-y-1">
        <label htmlFor="biz-industry" className="text-sm font-medium text-neutral-700">Industry (optional)</label>
        <input id="biz-industry" value={industryValue} onChange={(e) => setIndustryValue(e.target.value)} className={input} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setValue(name);
            setIndustryValue(industry ?? "");
          }}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
