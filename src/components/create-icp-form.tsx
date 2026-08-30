"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function CreateIcpForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [budget, setBudget] = useState("");
  const [problems, setProblems] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/businesses/${businessId}/icp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        industry: industry || undefined,
        location: location || undefined,
        companySize: companySize || undefined,
        budget: budget || undefined,
        problems: problems || undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setError(body.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    setName(""); setIndustry(""); setLocation(""); setCompanySize(""); setBudget(""); setProblems("");
    setOpen(false);
    setLoading(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        + New ICP profile
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="space-y-1">
        <label htmlFor="icp-name" className="text-sm font-medium text-neutral-700">Profile name</label>
        <input
          id="icp-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Established coaching business owners"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="icp-industry" className="text-sm font-medium text-neutral-700">Industry</label>
          <input id="icp-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label htmlFor="icp-location" className="text-sm font-medium text-neutral-700">Location</label>
          <input id="icp-location" value={location} onChange={(e) => setLocation(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label htmlFor="icp-company-size" className="text-sm font-medium text-neutral-700">Company size</label>
          <input id="icp-company-size" value={companySize} onChange={(e) => setCompanySize(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label htmlFor="icp-budget" className="text-sm font-medium text-neutral-700">Budget</label>
          <input id="icp-budget" value={budget} onChange={(e) => setBudget(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none" />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="icp-problems" className="text-sm font-medium text-neutral-700">Problems they have</label>
        <textarea id="icp-problems" rows={3} value={problems} onChange={(e) => setProblems(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
