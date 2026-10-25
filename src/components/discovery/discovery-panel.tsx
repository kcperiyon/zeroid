"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { INDUSTRIES } from "@/lib/discovery/industries";
import { Card, Field, Notice, buttonClass, ghostButtonClass, inputClass } from "@/components/campaigns/ui";

type Job = {
  id: string;
  name: string;
  status: string;
  industries: string[];
  locations: string[];
  cellsTotal: number;
  cellsDone: number;
  found: number;
  duplicates: number;
  maxProspects: number;
  lastError: string | null;
  enrichment: { pending: number; done: number; skipped: number; failed: number };
};

type EmailRow = { email: string; kind: string; source: string; personName: string | null; confidence: number; reasons: string[]; smtp: string };
type Prospect = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  domain: string | null;
  status: string;
  enrichStatus: string;
  enrichError: string | null;
  email: string | null;
  bestEmailConfidence: number | null;
  researchNote: string | null;
  existingLeadId: string | null;
  people: { name: string; title?: string }[];
  emails: EmailRow[];
};

const STATUS_TONE: Record<string, string> = {
  planning: "bg-neutral-100 text-neutral-600",
  running: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  done: "bg-brand-100 text-brand-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-neutral-100 text-neutral-500",
};

const labelOf = (key: string) => INDUSTRIES.find((i) => i.key === key)?.label ?? key.replace(/^osm:/, "OSM ");

function ConfidencePill({ value, threshold }: { value: number | null; threshold: number }) {
  if (value === null) return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">no address</span>;
  const tone = value >= threshold ? "bg-green-100 text-green-700" : value >= 30 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{value}/100</span>;
}

export function DiscoveryPanel({
  businessId, canRun, canImport, placesConfigured, initialJobs,
}: { businessId: string; canRun: boolean; canImport: boolean; placesConfigured: boolean; initialJobs: Job[] }) {
  const base = `/api/businesses/${businessId}/discovery`;

  // ---- new search form ----
  const [industries, setIndustries] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [locations, setLocations] = useState("");
  const [usePlaces, setUsePlaces] = useState(false);
  const [maxProspects, setMaxProspects] = useState(150);
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ---- jobs and results ----
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [filterJob, setFilterJob] = useState("");
  const [minConf, setMinConf] = useState<"" | "sendable" | "80">("");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [results, setResults] = useState<Prospect[]>([]);
  const [total, setTotal] = useState(0);
  const [threshold, setThreshold] = useState(60);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const res = await fetch(`${base}/jobs`);
    if (res.ok) setJobs(((await res.json()) as { jobs: Job[] }).jobs);
  }, [base]);

  const loadResults = useCallback(
    async (offset = 0) => {
      const p = new URLSearchParams({ limit: "30", offset: String(offset) });
      if (filterJob) p.set("jobId", filterJob);
      if (q.trim()) p.set("q", q.trim());
      if (showDone) p.set("enrich", "done");
      if (minConf === "80") p.set("minConfidence", "80");
      if (minConf === "sendable") p.set("minConfidence", String(threshold));
      const res = await fetch(`${base}/prospects?${p}`);
      if (!res.ok) return;
      const data = (await res.json()) as { prospects: Prospect[]; total: number; threshold: number };
      setThreshold(data.threshold);
      setTotal(data.total);
      setResults((prev) => (offset === 0 ? data.prospects : [...prev, ...data.prospects]));
    },
    [base, filterJob, q, showDone, minConf, threshold]
  );

  useEffect(() => {
    const t = setTimeout(() => void loadResults(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadResults, q]);

  // Poll while anything is still working.
  const active = useMemo(() => jobs.some((j) => ["planning", "running"].includes(j.status) || j.enrichment.pending > 0), [jobs]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      void loadJobs();
      void loadResults(0);
    }, 6000);
    return () => clearInterval(t);
  }, [active, loadJobs, loadResults]);

  async function start() {
    setFormError(null);
    const locs = locations.split("\n").map((s) => s.trim()).filter(Boolean);
    const picked = [...industries, ...(custom.trim() ? [`osm:${custom.trim().toLowerCase()}`] : [])];
    if (!picked.length) return setFormError("Pick at least one industry.");
    if (!locs.length) return setFormError("Add at least one place, one per line (for example: Ikeja, Lagos, Nigeria).");
    setCreating(true);
    const res = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${labelOf(picked[0])}${picked.length > 1 ? ` +${picked.length - 1}` : ""} in ${locs[0]}${locs.length > 1 ? ` +${locs.length - 1}` : ""}`.slice(0, 120),
        industries: picked, locations: locs, sources: usePlaces ? ["osm", "places"] : ["osm"], maxProspects, autoEnrich,
      }),
    });
    setCreating(false);
    if (!res.ok) return setFormError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not start the search.");
    setIndustries([]);
    setCustom("");
    setLocations("");
    setNotice({ tone: "ok", text: "Search started. It runs in the background; this page updates by itself." });
    await loadJobs();
  }

  async function jobAction(id: string, action: "pause" | "resume" | "cancel") {
    setBusy(id);
    await fetch(`${base}/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(null);
    await loadJobs();
  }

  async function importJob(id: string) {
    setBusy(`import-${id}`);
    const res = await fetch(`/api/businesses/${businessId}/prospects/import-bulk`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: id, onlyWithEmail: true, limit: 1000 }),
    });
    setBusy(null);
    if (!res.ok) return setNotice({ tone: "error", text: "Import failed." });
    const r = (await res.json()) as { imported: number; skippedNoEmail: number };
    setNotice({ tone: "ok", text: `${r.imported} prospect${r.imported === 1 ? "" : "s"} with a checked email address imported as leads. ${r.skippedNoEmail} left out (no address that passed the check yet).` });
    await Promise.all([loadJobs(), loadResults(0)]);
  }

  async function prospectAction(id: string, action: "import" | "dismiss" | "reenrich") {
    setBusy(id);
    const res = await fetch(`${base}/prospects/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(null);
    if (!res.ok) return setNotice({ tone: "error", text: "That did not work." });
    await loadResults(0);
  }

  const toggle = (key: string) => setIndustries((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  return (
    <div className="space-y-6">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {canRun && (
        <Card title="Find companies">
          <p className="mb-4 text-sm text-neutral-600">
            Pick the kinds of business and the places. Zeroid maps each place into small squares, lists the businesses OpenStreetMap knows there, then reads each company&apos;s own public website for contact details. It never touches LinkedIn, Facebook or Instagram.
          </p>
          <div className="space-y-4">
            <Field label="Industries" hint="Pick one or more.">
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map((i) => (
                  <button
                    key={i.key}
                    type="button"
                    onClick={() => toggle(i.key)}
                    className={`rounded-full border px-3 py-1.5 text-sm ${industries.includes(i.key) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}
                    aria-pressed={industries.includes(i.key)}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Or an OpenStreetMap tag" hint="Optional, for something not listed: for example shop=furniture">
              <input className={inputClass} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="shop=furniture" />
            </Field>
            <Field label="Places (one per line)" hint="Cities or districts work best, with the country: Ikeja, Lagos, Nigeria. A whole country is too big; list its main cities.">
              <textarea className={inputClass} rows={3} value={locations} onChange={(e) => setLocations(e.target.value)} placeholder={"Ikeja, Lagos, Nigeria\nVictoria Island, Lagos, Nigeria"} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stop after this many companies">
                <input type="number" className={inputClass} min={1} max={2000} value={maxProspects} onChange={(e) => setMaxProspects(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} />
              </Field>
              <div className="space-y-2 pt-6 text-sm text-neutral-700">
                <label className="flex items-center gap-2"><input type="checkbox" checked={autoEnrich} onChange={(e) => setAutoEnrich(e.target.checked)} /> Read their websites for contact details</label>
                <label className={`flex items-center gap-2 ${placesConfigured ? "" : "text-neutral-400"}`}>
                  <input type="checkbox" disabled={!placesConfigured} checked={usePlaces} onChange={(e) => setUsePlaces(e.target.checked)} /> Also search Google Places{!placesConfigured && " (not set up on this server)"}
                </label>
              </div>
            </div>
            {formError && <Notice tone="error">{formError}</Notice>}
            <button className={buttonClass} onClick={start} disabled={creating}>{creating ? "Starting…" : "Start search"}</button>
          </div>
        </Card>
      )}

      <Card title="Searches" aside={active ? <span className="text-xs text-neutral-400">updating…</span> : undefined}>
        {jobs.length === 0 ? (
          <p className="text-sm text-neutral-500">No searches yet.</p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((j) => {
              const pct = j.cellsTotal ? Math.round((j.cellsDone / j.cellsTotal) * 100) : 0;
              const checked = j.enrichment.done + j.enrichment.skipped + j.enrichment.failed;
              return (
                <li key={j.id} className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-neutral-900">{j.name}</p>
                      <p className="text-xs text-neutral-500">{j.industries.map(labelOf).join(", ")} · {j.locations.join("; ")}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_TONE[j.status] ?? STATUS_TONE.planning}`}>{j.status}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full bg-brand-600" style={{ width: `${j.status === "done" ? 100 : pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-neutral-600">
                    {j.cellsTotal ? `${j.cellsDone}/${j.cellsTotal} map squares · ` : "Looking up the places… · "}
                    {j.found} companies found{j.duplicates ? ` (${j.duplicates} duplicates merged)` : ""} · {checked} reviewed{j.enrichment.pending ? `, ${j.enrichment.pending} waiting` : ""}
                  </p>
                  {j.lastError && <p className="mt-1 text-xs text-amber-700">{j.lastError}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className={ghostButtonClass} onClick={() => { setFilterJob(j.id); setShowDone(false); }}>Show results</button>
                    {canImport && <button className={ghostButtonClass} disabled={busy === `import-${j.id}`} onClick={() => importJob(j.id)}>Import checked addresses as leads</button>}
                    {canRun && ["running", "planning"].includes(j.status) && <button className={ghostButtonClass} disabled={busy === j.id} onClick={() => jobAction(j.id, "pause")}>Pause</button>}
                    {canRun && j.status === "paused" && <button className={ghostButtonClass} disabled={busy === j.id} onClick={() => jobAction(j.id, "resume")}>Resume</button>}
                    {canRun && ["running", "planning", "paused"].includes(j.status) && <button className={ghostButtonClass} disabled={busy === j.id} onClick={() => jobAction(j.id, "cancel")}>Cancel</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={`Companies found (${total})`}>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <select className={inputClass} value={filterJob} onChange={(e) => setFilterJob(e.target.value)} aria-label="Search">
            <option value="">All searches</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
          <select className={inputClass} value={minConf} onChange={(e) => setMinConf(e.target.value as "" | "sendable" | "80")} aria-label="Email confidence">
            <option value="">Any confidence</option>
            <option value="sendable">Good enough to email ({threshold}+)</option>
            <option value="80">Very high (80+)</option>
          </select>
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, site or place" aria-label="Search companies" />
          <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Only websites already checked</label>
        </div>

        {results.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing here yet.</p>
        ) : (
          <ul className="space-y-3">
            {results.map((p) => {
              const expanded = open === p.id;
              return (
                <li key={p.id} className="rounded-lg border border-neutral-200 p-3">
                  <button className="flex w-full flex-wrap items-start justify-between gap-2 text-left" onClick={() => setOpen(expanded ? null : p.id)} aria-expanded={expanded}>
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-medium text-neutral-900">{p.name}</span>
                      <span className="block break-words text-xs text-neutral-500">{[p.category, p.address].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {p.status === "imported" && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">lead</span>}
                      {p.existingLeadId && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">already a lead</span>}
                      <ConfidencePill value={p.bestEmailConfidence} threshold={threshold} />
                    </span>
                  </button>
                  <p className="mt-1 break-all text-xs text-neutral-500">
                    {p.website ? <a className="text-brand-700 underline" href={p.website} target="_blank" rel="noopener noreferrer">{p.domain ?? p.website}</a> : "no website listed"}
                    {p.email ? ` · ${p.email}` : ""}
                    {p.enrichStatus === "pending" || p.enrichStatus === "running" ? " · checking…" : ""}
                    {p.enrichStatus === "failed" ? ` · could not read site${p.enrichError ? ` (${p.enrichError})` : ""}` : ""}
                    {p.enrichStatus === "skipped" && p.enrichError ? ` · ${p.enrichError}` : ""}
                  </p>

                  {expanded && (
                    <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
                      {p.researchNote && <p className="text-sm text-neutral-700">{p.researchNote}</p>}
                      {p.people.length > 0 && <p className="text-xs text-neutral-600">People on their site: {p.people.map((x) => (x.title ? `${x.name} (${x.title})` : x.name)).join("; ")}</p>}
                      {p.emails.length > 0 ? (
                        <ul className="space-y-2">
                          {p.emails.map((e) => (
                            <li key={e.email} className="rounded-md bg-neutral-50 p-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="break-all font-medium text-neutral-800">{e.email}{e.personName ? ` · ${e.personName}` : ""}</span>
                                <span className="flex items-center gap-2">
                                  <span className="text-neutral-500">{e.kind === "pattern_guess" ? "guess" : e.kind}</span>
                                  <ConfidencePill value={e.confidence} threshold={threshold} />
                                </span>
                              </div>
                              <ul className="mt-1 list-disc pl-4 text-neutral-500">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-neutral-500">No email addresses recorded.</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {canImport && p.status === "new" && <button className={buttonClass} disabled={busy === p.id} onClick={() => prospectAction(p.id, "import")}>Import as lead</button>}
                        {canImport && p.status === "new" && <button className={ghostButtonClass} disabled={busy === p.id} onClick={() => prospectAction(p.id, "dismiss")}>Dismiss</button>}
                        {canImport && (p.website || p.email) && <button className={ghostButtonClass} disabled={busy === p.id} onClick={() => prospectAction(p.id, "reenrich")}>Check again</button>}
                      </div>
                      {p.status === "new" && p.bestEmailConfidence !== null && p.bestEmailConfidence < threshold && (
                        <p className="text-xs text-amber-700">No address here is reliable enough to email, so it will import as a lead without an email address.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {results.length < total && <button className={`${ghostButtonClass} mt-4`} onClick={() => loadResults(results.length)}>Show more</button>}
      </Card>
    </div>
  );
}
