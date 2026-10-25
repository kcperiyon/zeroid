"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ghostButtonClass, Notice } from "./ui";
import { IdentityForm, type PublicIdentity } from "./identity-form";

type Check = { name: string; status: "pass" | "warn" | "fail"; detail: string };
type Props = {
  businessId: string;
  canManage: boolean;
  isOwner: boolean;
  identity: PublicIdentity & { sandboxOnly: boolean; active: boolean; imapLastError: string | null; imapLastCheckAt: string | null };
};

const DOT: Record<string, string> = { pass: "bg-green-500", warn: "bg-amber-500", fail: "bg-red-500" };

export function IdentityCard({ businessId, canManage, isOwner, identity: i }: Props) {
  const router = useRouter();
  const base = `/api/businesses/${businessId}/identities/${i.id}`;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const shared = i.provider === "brevo_shared";

  async function call(label: string, path: string, init: RequestInit = { method: "POST" }) {
    setBusy(label);
    setNote(null);
    const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    return { ok: res.ok, data };
  }

  async function health() {
    const { ok, data } = await call("health", "/health");
    if (!ok) return setNote({ tone: "error", text: data.error ?? "Could not run the check." });
    setChecks(data.checks);
  }
  async function mailbox() {
    const { ok, data } = await call("mailbox", "/mailbox-check");
    setNote(ok && data.ok ? { tone: "ok", text: "Connected to the reply mailbox." } : { tone: "error", text: data.error ?? "Could not connect to the reply mailbox." });
  }
  async function toggle(patch: Record<string, unknown>, label: string) {
    const { ok, data } = await call(label, "", { method: "PATCH", body: JSON.stringify(patch) });
    if (!ok) return setNote({ tone: "error", text: data.error ?? "Could not change that." });
    router.refresh();
  }
  async function remove() {
    if (!confirm(`Delete the sending identity "${i.name}"?`)) return;
    const { ok, data } = await call("delete", "", { method: "DELETE" });
    if (!ok) return setNote({ tone: "error", text: data.error ?? "Could not delete." });
    router.refresh();
  }

  if (editing) {
    return (
      <li className="py-3">
        <IdentityForm businessId={businessId} canManage={canManage} identity={i} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const mode = shared || i.sandboxOnly ? "Sandbox" : "Live-enabled";
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-neutral-800">
            {i.name} <span className="font-normal text-neutral-500">— {i.fromName} &lt;{i.fromEmail}&gt;</span>
            {!i.active && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">switched off</span>}
          </p>
          <p className="text-xs text-neutral-500">
            {shared ? "Shared Brevo (testing only)" : `Own SMTP (${i.smtpHost})`} · {i.dailyCap}/day · {mode}
            {i.imapHost ? ` · replies read from ${i.imapUser}` : " · no reply mailbox"}
          </p>
          {i.imapLastError && <p className="text-xs text-red-600">Mailbox problem: {i.imapLastError}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={ghostButtonClass + " !px-3 !py-1.5 !text-xs"} disabled={busy !== null} onClick={health}>{busy === "health" ? "Checking…" : "Check domain (SPF/DKIM/DMARC)"}</button>
        {i.imapHost && <button className={ghostButtonClass + " !px-3 !py-1.5 !text-xs"} disabled={busy !== null} onClick={mailbox}>{busy === "mailbox" ? "Testing…" : "Test reply mailbox"}</button>}
        {canManage && <button className={ghostButtonClass + " !px-3 !py-1.5 !text-xs"} onClick={() => setEditing(true)}>Edit</button>}
        {canManage && <button className={ghostButtonClass + " !px-3 !py-1.5 !text-xs"} disabled={busy !== null} onClick={() => toggle({ active: !i.active }, "active")}>{i.active ? "Switch off" : "Switch on"}</button>}
        {isOwner && !shared && (
          i.sandboxOnly ? (
            <button
              className={ghostButtonClass + " !px-3 !py-1.5 !text-xs"}
              disabled={busy !== null}
              onClick={() => confirm("Take this identity out of sandbox? It will then be allowed to email real prospects once the server has live sending switched on.") && toggle({ sandboxOnly: false }, "sandbox")}
            >
              Take out of sandbox…
            </button>
          ) : (
            <button className={ghostButtonClass + " !px-3 !py-1.5 !text-xs"} disabled={busy !== null} onClick={() => toggle({ sandboxOnly: true }, "sandbox")}>Put back in sandbox</button>
          )
        )}
        {canManage && <button className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50" disabled={busy !== null} onClick={remove}>Delete</button>}
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {checks && (
        <ul className="space-y-1.5 rounded-lg border border-neutral-200 p-3">
          {checks.map((c) => (
            <li key={c.name} className="flex gap-2">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.status]}`} />
              <span><strong>{c.name}</strong> — {c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
