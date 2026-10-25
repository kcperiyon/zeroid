"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, Field, ghostButtonClass, inputClass, Notice } from "./ui";

const CHANNELS = ["manual", "csv", "google", "news", "youtube", "etsy", "instagram", "facebook", "whatsapp", "webhook", "api", "referral", "linkedin", "tiktok", "email", "osm", "registry"];
const STAGES = ["new", "contacted", "engaged", "qualified", "hot", "appointment", "proposal", "negotiation", "won", "lost"];

type Preview = { count: number; sample: { name: string | null; company: string | null; email: string | null }[] };

export type SegmentFilterValues = {
  channels?: string[]; stages?: string[]; medium?: string; minScore?: number; maxScore?: number; companyContains?: string;
};

export function SegmentBuilder({
  businessId,
  segment,
  onDone,
}: {
  businessId: string;
  /** When given, the builder edits this segment instead of creating a new one. */
  segment?: { id: string; name: string; filter: SegmentFilterValues };
  onDone?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(segment);
  const [open, setOpen] = useState(editing);
  const [name, setName] = useState(segment?.name ?? "");
  const [channels, setChannels] = useState<string[]>(segment?.filter.channels ?? []);
  const [stages, setStages] = useState<string[]>(segment?.filter.stages ?? []);
  const [medium, setMedium] = useState(segment?.filter.medium ?? "");
  const [minScore, setMinScore] = useState(segment?.filter.minScore !== undefined ? String(segment.filter.minScore) : "");
  const [maxScore, setMaxScore] = useState(segment?.filter.maxScore !== undefined ? String(segment.filter.maxScore) : "");
  const [company, setCompany] = useState(segment?.filter.companyContains ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const filter = () => ({
    ...(channels.length ? { channels } : {}),
    ...(stages.length ? { stages } : {}),
    ...(medium ? { medium } : {}),
    ...(minScore !== "" ? { minScore: Number(minScore) } : {}),
    ...(maxScore !== "" ? { maxScore: Number(maxScore) } : {}),
    ...(company.trim() ? { companyContains: company.trim() } : {}),
  });

  async function runPreview() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/businesses/${businessId}/segments/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filter()) });
    setBusy(false);
    if (!res.ok) return setError("Could not preview that filter.");
    setPreview(await res.json());
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(
      editing ? `/api/businesses/${businessId}/segments/${segment!.id}` : `/api/businesses/${businessId}/segments`,
      { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, filter: filter() }) }
    );
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not save.");
    if (!editing) {
      setOpen(false);
      setName("");
      setPreview(null);
    }
    onDone?.();
    router.refresh();
  }

  if (!open) return <button className={buttonClass} onClick={() => setOpen(true)}>+ New segment</button>;

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium ${active ? "border-brand-500 bg-brand-50 text-brand-700" : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"}`;

  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Segment name"><input required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Solar installers from news" /></Field>
      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700">Came from (any)</p>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <button type="button" key={c} className={chip(channels.includes(c))} onClick={() => toggle(channels, setChannels, c)}>{c}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-neutral-700">Pipeline stage (any)</p>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button type="button" key={s} className={chip(stages.includes(s))} onClick={() => toggle(stages, setStages, s)}>{s}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Source type">
          <select className={inputClass} value={medium} onChange={(e) => setMedium(e.target.value)}>
            <option value="">Organic + paid</option><option value="organic">Organic only</option><option value="paid">Paid only</option>
          </select>
        </Field>
        <Field label="Min score"><input type="number" min={0} max={100} className={inputClass} value={minScore} onChange={(e) => setMinScore(e.target.value)} /></Field>
        <Field label="Max score"><input type="number" min={0} max={100} className={inputClass} value={maxScore} onChange={(e) => setMaxScore(e.target.value)} /></Field>
        <Field label="Company contains"><input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-neutral-400">Only leads that have an email address are ever included.</p>
      {preview && (
        <Notice tone="info">
          <strong>{preview.count}</strong> lead{preview.count === 1 ? "" : "s"} match.
          {preview.sample.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {preview.sample.map((s, i) => <li key={i}>{[s.name, s.company, s.email].filter(Boolean).join(" · ")}</li>)}
            </ul>
          )}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ghostButtonClass} disabled={busy} onClick={runPreview}>Preview who matches</button>
        <button className={buttonClass} disabled={busy}>{editing ? "Save changes" : "Save segment"}</button>
        <button type="button" className="rounded-md px-4 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100" onClick={() => (editing ? onDone?.() : setOpen(false))}>Cancel</button>
      </div>
    </form>
  );
}
