"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass, Notice } from "./ui";

type Entry = { id: string; email: string; reason: string; createdAt: string };

const REASON: Record<string, string> = {
  unsubscribe: "Unsubscribed",
  manual: "Added by you",
  hard_bounce: "Hard bounce",
  complaint: "Complaint",
  global_optout: "Opted out of all senders",
};

export function SuppressionList({ businessId, entries, platformWideCount }: { businessId: string; entries: Entry[]; platformWideCount: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/businesses/${businessId}/suppressions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: text }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "error", text: data.error ?? "Could not add." });
    setMsg({
      tone: "ok",
      text: `Added ${data.added} address${data.added === 1 ? "" : "es"}${data.ignored ? ` (${data.ignored} ignored: not valid emails)` : ""}. Pending emails to them were cancelled.`,
    });
    setText("");
    router.refresh();
  }

  async function remove(email: string) {
    const res = await fetch(`/api/businesses/${businessId}/suppressions?email=${encodeURIComponent(email)}`, { method: "DELETE" });
    if (!res.ok) return setMsg({ tone: "error", text: (await res.json().catch(() => ({}))).error ?? "Could not remove." });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={add} className="space-y-2">
        <textarea
          className={inputClass}
          rows={2}
          placeholder="Paste emails to never contact (comma, space or new line separated)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className={buttonClass} disabled={busy || text.trim().length < 3}>{busy ? "Adding…" : "Add to do-not-email list"}</button>
      </form>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <p className="text-xs text-neutral-500">
        {entries.length} on this business list. Zeroid also keeps a platform-wide list of {platformWideCount} address{platformWideCount === 1 ? "" : "es"} (hard
        bounces, spam complaints and people who opted out of every sender) that is always honoured.
      </p>
      {entries.length > 0 && (
        <ul className="divide-y divide-neutral-100 text-sm">
          {entries.slice(0, 50).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate text-neutral-800">{s.email}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-neutral-500">
                {REASON[s.reason] ?? s.reason}
                {(s.reason === "manual" || s.reason === "unsubscribe") && (
                  <button className="font-medium text-red-600 hover:underline" onClick={() => remove(s.email)}>Remove</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {entries.length > 50 && <p className="text-xs text-neutral-400">Showing the latest 50.</p>}
    </div>
  );
}
