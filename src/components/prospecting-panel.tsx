"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type IcpProfile = { id: string; name: string; attributes: Record<string, string | undefined> };
type Prospect = {
  id: string;
  channel: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  status: "new" | "imported" | "dismissed";
  createdAt: string;
};

export function ProspectingPanel({
  businessId,
  icpProfiles,
  prospects,
}: {
  businessId: string;
  icpProfiles: IcpProfile[];
  prospects: Prospect[];
}) {
  const router = useRouter();
  const [icpId, setIcpId] = useState<string>(icpProfiles[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selectedIcp = icpProfiles.find((p) => p.id === icpId);
  const suggestedQuery = selectedIcp
    ? [selectedIcp.attributes.industry, selectedIcp.attributes.location].filter(Boolean).join(" in ")
    : "";

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/businesses/${businessId}/prospects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query || suggestedQuery }),
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

  async function handleAction(prospectId: string, action: "import" | "dismiss") {
    setBusyId(prospectId);
    await fetch(`/api/businesses/${businessId}/prospects/${prospectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    router.refresh();
  }

  const newProspects = prospects.filter((p) => p.status === "new");
  const decided = prospects.filter((p) => p.status !== "new");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Find prospects</h2>
        <form onSubmit={handleSearch} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          {icpProfiles.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="prospect-icp" className="text-sm font-medium text-neutral-700">ICP profile</label>
              <select
                id="prospect-icp"
                value={icpId}
                onChange={(e) => setIcpId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              >
                {icpProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="prospect-query" className="text-sm font-medium text-neutral-700">Search (industry + location)</label>
            <input
              id="prospect-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={suggestedQuery || "e.g. business coaches in Lagos"}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
            <p className="text-xs text-neutral-400">Leave blank to use the selected ICP&apos;s industry + location.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || (!query && !suggestedQuery)}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search Google Places"}
          </button>
        </form>
      </div>

      {newProspects.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">New prospects</h2>
          <div className="space-y-2">
            {newProspects.map((p) => (
              <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{p.name}</p>
                    <p className="text-xs text-neutral-500">
                      {[p.category, p.address].filter(Boolean).join(" · ")}
                    </p>
                    {(p.phone || p.website) && (
                      <p className="mt-1 text-xs text-neutral-400">
                        {[p.phone, p.website].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      disabled={busyId === p.id}
                      onClick={() => handleAction(p.id, "import")}
                      className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                    >
                      Import as lead
                    </button>
                    <button
                      disabled={busyId === p.id}
                      onClick={() => handleAction(p.id, "dismiss")}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {decided.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Reviewed</h2>
          <div className="space-y-1">
            {decided.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm">
                <span className="text-neutral-700">{p.name}</span>
                <span className={p.status === "imported" ? "text-green-600" : "text-neutral-400"}>{p.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-dashed border-neutral-300 p-4">
        <h2 className="text-sm font-semibold text-neutral-700">Prospecting from LinkedIn or manual research?</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Zeroid doesn&apos;t automate LinkedIn (against their terms, and a real
          legal risk). Search LinkedIn Sales Navigator yourself, export or
          copy your list into a spreadsheet with <code>name</code>,{" "}
          <code>email</code>, <code>phone</code>, <code>company</code>{" "}
          columns, then{" "}
          <a href={`/businesses/${businessId}/leads`} className="underline">
            import it as a CSV on the Leads tab
          </a>
          .
        </p>
      </div>
    </div>
  );
}
