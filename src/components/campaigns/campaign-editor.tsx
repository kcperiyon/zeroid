"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, Card, Field, ghostButtonClass, inputClass, Notice, StatusBadge } from "./ui";

type Step = { delayDays: number; subject: string; body: string; aiPersonalise: boolean };
type EventRow = { id: string; type: string; to: string; at: string; payload: Record<string, unknown> };
type Props = {
  businessId: string;
  campaign: {
    id: string; name: string; objective: string | null; status: string; segmentName: string; identityName: string; fromLabel: string;
    timezone: string; sendStartHour: number; sendEndHour: number; weekdaysOnly: boolean;
  };
  sandboxed: boolean;
  steps: Step[];
  stats: { messages: Record<string, number>; events: Record<string, number> };
  events: EventRow[];
};

/** Same text on server and first client render (UTC), then the viewer's local time -- avoids a hydration mismatch. */
function LocalTime({ iso }: { iso: string }) {
  const utc = new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC";
  const [text, setText] = useState(utc);
  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}

const EVENT_LABEL: Record<string, string> = {
  sent: "Sent", delivered: "Delivered", bounced: "Bounced", opened: "Opened", clicked: "Clicked",
  replied: "Replied", unsubscribed: "Unsubscribed", complained: "Complaint", blocked: "Blocked",
};

export function CampaignEditor({ businessId, campaign, sandboxed, steps: initialSteps, stats, events }: Props) {
  const router = useRouter();
  const base = `/api/businesses/${businessId}/campaigns/${campaign.id}`;
  const editable = campaign.status === "draft";
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; from: string; step: number } | null>(null);
  const [testTo, setTestTo] = useState("");

  const patchStep = (i: number, p: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function call(label: string, path: string, body?: unknown, method = "POST") {
    setBusy(label);
    setMsg(null);
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    return { ok: res.ok, data };
  }

  async function saveSteps() {
    const { ok, data } = await call("save", "", { steps }, "PATCH");
    setMsg(ok ? { tone: "ok", text: "Sequence saved." } : { tone: "error", text: data.error ?? "Could not save." });
    if (ok) router.refresh();
    return ok;
  }

  async function launch() {
    if (editable && !(await saveSteps())) return;
    const { ok, data } = await call("launch", "/launch");
    if (!ok) return setMsg({ tone: "error", text: data.error ?? "Could not start." });
    setMsg({
      tone: "ok",
      text: data.resumed === false || data.scheduled !== undefined
        ? `Started. ${data.scheduled} email${data.scheduled === 1 ? "" : "s"} scheduled · ${data.suppressed} suppressed · ${data.invalid} invalid address${data.invalid === 1 ? "" : "es"} · ${data.duplicate} duplicate.`
        : "Resumed.",
    });
    router.refresh();
  }

  async function pause() {
    const { ok, data } = await call("pause", "/pause");
    setMsg(ok ? { tone: "info", text: "Paused. Nothing more will be sent until you resume." } : { tone: "error", text: data.error ?? "Could not pause." });
    router.refresh();
  }

  async function showPreview(step: number) {
    if (editable) await saveSteps();
    const { ok, data } = await call("preview", "/preview", { step });
    if (!ok) return setMsg({ tone: "error", text: data.error ?? "Could not preview." });
    setPreview({ subject: data.subject, html: data.html, from: data.from, step });
  }

  async function testSend(step: number) {
    if (editable) await saveSteps();
    const { ok, data } = await call("test", "/test-send", { to: testTo, step });
    setMsg(ok ? { tone: "ok", text: `Test email sent to ${testTo} (${data.mode}).` } : { tone: "error", text: data.error ?? "Could not send the test." });
  }

  const m = stats.messages;
  const e = stats.events;
  const tiles: [string, number][] = [
    ["Queued", m.scheduled ?? 0], ["Sent", m.sent ?? 0], ["Opened", e.opened ?? 0], ["Clicked", e.clicked ?? 0],
    ["Replied", e.replied ?? 0], ["Bounced", e.bounced ?? 0], ["Unsubscribed", e.unsubscribed ?? 0], ["Blocked/skipped", m.skipped ?? 0],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900">{campaign.name}</h2>
          <p className="mt-1 text-sm text-neutral-500">Segment: {campaign.segmentName} · From: {campaign.fromLabel}</p>
          <p className="text-xs text-neutral-400">
            Sends {campaign.sendStartHour}:00–{campaign.sendEndHour}:00 {campaign.timezone}{campaign.weekdaysOnly ? ", weekdays" : ""}
          </p>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      {sandboxed && (
        <Notice tone="warn">
          <strong>Sandbox mode.</strong> Only allow-listed test addresses will actually receive these emails. Every other recipient is blocked and shown as
          skipped, so launching is safe while you test.
        </Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="flex flex-wrap gap-2">
        {(campaign.status === "draft" || campaign.status === "paused") && (
          <button className={buttonClass} disabled={busy !== null} onClick={launch}>
            {busy === "launch" ? "Starting…" : campaign.status === "paused" ? "Resume campaign" : "Launch campaign"}
          </button>
        )}
        {campaign.status === "active" && (
          <button className={ghostButtonClass} disabled={busy !== null} onClick={pause}>{busy === "pause" ? "Pausing…" : "Pause campaign"}</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white p-3">
            <p className="text-2xl font-semibold text-neutral-900">{n}</p>
            <p className="text-xs text-neutral-500">{label}</p>
          </div>
        ))}
      </div>

      <Card title="Email sequence">
        {!editable && <p className="mb-3 text-sm text-neutral-500">The sequence is locked once a campaign has launched. You can still preview and test-send each step.</p>}
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-neutral-200 p-3 sm:p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-800">Step {i + 1}</p>
                {editable && steps.length > 1 && (
                  <button className="text-xs font-medium text-red-600 hover:underline" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>Remove</button>
                )}
              </div>
              {i > 0 && (
                <Field label="Wait (days after the previous email)">
                  <input type="number" min={0} max={60} disabled={!editable} className={inputClass + " max-w-[8rem]"} value={s.delayDays} onChange={(ev) => patchStep(i, { delayDays: Number(ev.target.value) })} />
                </Field>
              )}
              <div className="mt-2 space-y-2">
                <Field label="Subject"><input disabled={!editable} className={inputClass} value={s.subject} onChange={(ev) => patchStep(i, { subject: ev.target.value })} /></Field>
                <Field label="Message" hint="Use {{firstName}}, {{company}}, {{senderName}}. Lines in [[double brackets]] are prompts — rewrite them before launching.">
                  <textarea disabled={!editable} rows={7} className={inputClass} value={s.body} onChange={(ev) => patchStep(i, { body: ev.target.value })} />
                </Field>
                <label className="flex items-center gap-2 text-sm text-neutral-700">
                  <input type="checkbox" disabled={!editable} checked={s.aiPersonalise} onChange={(ev) => patchStep(i, { aiPersonalise: ev.target.checked })} />
                  Add an AI-written opening line for each person (costs a few AI credits per email)
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className={ghostButtonClass} disabled={busy !== null} onClick={() => showPreview(i + 1)}>Preview</button>
              </div>
            </div>
          ))}
        </div>
        {editable && (
          <div className="mt-3 flex flex-wrap gap-2">
            {steps.length < 6 && (
              <button className={ghostButtonClass} onClick={() => setSteps((x) => [...x, { delayDays: 4, subject: "", body: "", aiPersonalise: false }])}>+ Add step</button>
            )}
            <button className={buttonClass} disabled={busy !== null} onClick={saveSteps}>{busy === "save" ? "Saving…" : "Save sequence"}</button>
          </div>
        )}
      </Card>

      <Card title="Send yourself a test">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="email" className={inputClass} placeholder="your-test-inbox@example.com" value={testTo} onChange={(ev) => setTestTo(ev.target.value)} />
          <button className={ghostButtonClass + " shrink-0"} disabled={busy !== null || !testTo} onClick={() => testSend(1)}>Send step 1 test</button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">Only addresses on the server&apos;s sandbox allow-list can receive tests. Links in a test email are inert.</p>
      </Card>

      {preview && (
        <Card title={`Preview — step ${preview.step}`} aside={<button className="text-xs text-neutral-500 hover:text-neutral-900" onClick={() => setPreview(null)}>Close</button>}>
          <p className="text-xs text-neutral-500">From: {preview.from}</p>
          <p className="mb-2 text-sm font-medium text-neutral-900">Subject: {preview.subject}</p>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-80 w-full rounded-md border border-neutral-200 bg-white" />
        </Card>
      )}

      <Card title="Recent activity">
        {events.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing yet. Activity appears here as emails are sent, opened, replied to or blocked.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium text-neutral-800">{EVENT_LABEL[ev.type] ?? ev.type}</span>{" "}
                  <span className="text-neutral-500">{ev.to}</span>
                  {typeof ev.payload.class === "string" && <span className="text-neutral-400"> · {ev.payload.class.replace("_", " ")}</span>}
                  {typeof ev.payload.reason === "string" && <span className="text-neutral-400"> · {ev.payload.reason}</span>}
                </span>
                <span className="text-xs text-neutral-400"><LocalTime iso={ev.at} /></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
