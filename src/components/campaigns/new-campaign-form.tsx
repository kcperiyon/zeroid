"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, Field, inputClass, Notice } from "./ui";

type Option = { id: string; name: string };

export function NewCampaignForm({ businessId, segments, identities }: { businessId: string; segments: Option[]; identities: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? "");
  const [identityId, setIdentityId] = useState(identities[0]?.id ?? "");
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [start, setStart] = useState("9");
  const [end, setEnd] = useState("17");
  const [weekdays, setWeekdays] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (segments.length === 0 || identities.length === 0) {
    return <Notice tone="info">Add {identities.length === 0 ? "a sending identity" : ""}{identities.length === 0 && segments.length === 0 ? " and " : ""}{segments.length === 0 ? "a segment" : ""} first, then you can create a campaign.</Notice>;
  }
  if (!open) return <button className={buttonClass} onClick={() => setOpen(true)}>+ New campaign</button>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/businesses/${businessId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, objective: objective || undefined, segmentId, identityId, timezone, sendStartHour: Number(start), sendEndHour: Number(end), weekdaysOnly: weekdays }),
    });
    setLoading(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Something went wrong.");
    router.push(`/businesses/${businessId}/campaigns/${body.campaign.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Campaign name"><input required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Objective (optional)" hint="Used to guide AI personalisation."><input className={inputClass} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Book a 15-minute intro call" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Segment (who)">
          <select className={inputClass} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
        <Field label="Sending identity (from)">
          <select className={inputClass} value={identityId} onChange={(e) => setIdentityId(e.target.value)}>{identities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Timezone" hint="Emails go out in working hours in this zone (or the lead's own).">
          <input className={inputClass} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Field label="From hour"><input type="number" min={0} max={23} className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Until hour"><input type="number" min={1} max={24} className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700"><input type="checkbox" checked={weekdays} onChange={(e) => setWeekdays(e.target.checked)} /> Weekdays only</label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button className={buttonClass} disabled={loading}>{loading ? "Creating…" : "Create and edit sequence"}</button>
        <button type="button" className="rounded-md px-4 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
