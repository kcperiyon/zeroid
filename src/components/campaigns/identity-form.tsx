"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, Field, inputClass, Notice } from "./ui";

export function IdentityForm({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"brevo_shared" | "smtp">("brevo_shared");
  const [v, setV] = useState({
    name: "", fromEmail: "", fromName: "", replyToEmail: "", physicalAddress: "", dailyCap: "20",
    smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", smtpSecure: false,
    dkimDomain: "", dkimSelector: "", dkimPrivateKey: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  if (!canManage) return <p className="text-sm text-neutral-500">Ask an owner or admin to add a sending identity.</p>;
  if (!open) {
    return (
      <button className={buttonClass} onClick={() => setOpen(true)}>
        + Add sending identity
      </button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: v.name, provider, fromEmail: v.fromEmail, fromName: v.fromName,
      replyToEmail: v.replyToEmail || undefined, physicalAddress: v.physicalAddress, dailyCap: Number(v.dailyCap) || 20,
    };
    if (provider === "smtp") {
      Object.assign(body, {
        smtpHost: v.smtpHost, smtpPort: Number(v.smtpPort) || undefined, smtpSecure: v.smtpSecure,
        smtpUser: v.smtpUser || undefined, smtpPass: v.smtpPass || undefined,
        dkimDomain: v.dkimDomain || undefined, dkimSelector: v.dkimSelector || undefined, dkimPrivateKey: v.dkimPrivateKey || undefined,
      });
    }
    const res = await fetch(`/api/businesses/${businessId}/identities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setLoading(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Provider">
        <select className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value as "brevo_shared" | "smtp")}>
          <option value="brevo_shared">Shared Brevo account — testing only (sandbox)</option>
          <option value="smtp">Own SMTP server / relay (DKIM-signed by Zeroid)</option>
        </select>
      </Field>
      {provider === "brevo_shared" && (
        <Notice tone="warn">
          The shared Brevo account also sends other products&apos; mail, so it is locked to <strong>sandbox mode</strong>: only addresses on the
          server&apos;s allow-list can receive email, and everyone else is blocked in code.
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input required className={inputClass} value={v.name} onChange={set("name")} placeholder="e.g. Main outreach" /></Field>
        <Field label="From name"><input required className={inputClass} value={v.fromName} onChange={set("fromName")} placeholder="Kelechi at Deep Projects" /></Field>
        <Field label="From email"><input required type="email" className={inputClass} value={v.fromEmail} onChange={set("fromEmail")} /></Field>
        <Field label="Reply-to (optional)"><input type="email" className={inputClass} value={v.replyToEmail} onChange={set("replyToEmail")} /></Field>
      </div>
      <Field label="Physical postal address" hint="Required by anti-spam law; it is printed in the footer of every email.">
        <textarea required rows={2} className={inputClass} value={v.physicalAddress} onChange={set("physicalAddress")} />
      </Field>
      <Field label="Emails per day (starts at 20% and warms up over 14 days)">
        <input type="number" min={1} max={5000} className={inputClass} value={v.dailyCap} onChange={set("dailyCap")} />
      </Field>

      {provider === "smtp" && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SMTP host"><input required className={inputClass} value={v.smtpHost} onChange={set("smtpHost")} /></Field>
            <Field label="Port"><input className={inputClass} value={v.smtpPort} onChange={set("smtpPort")} /></Field>
            <Field label="Username"><input className={inputClass} value={v.smtpUser} onChange={set("smtpUser")} autoComplete="off" /></Field>
            <Field label="Password"><input type="password" className={inputClass} value={v.smtpPass} onChange={set("smtpPass")} autoComplete="new-password" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={v.smtpSecure} onChange={(e) => setV((s) => ({ ...s, smtpSecure: e.target.checked }))} /> Use implicit TLS (port 465)
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="DKIM domain"><input className={inputClass} value={v.dkimDomain} onChange={set("dkimDomain")} placeholder="mail.example.com" /></Field>
            <Field label="DKIM selector"><input className={inputClass} value={v.dkimSelector} onChange={set("dkimSelector")} placeholder="zeroid1" /></Field>
          </div>
          <Field label="DKIM private key (PEM)"><textarea rows={3} className={inputClass} value={v.dkimPrivateKey} onChange={set("dkimPrivateKey")} /></Field>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button className={buttonClass} disabled={loading}>{loading ? "Saving…" : "Save identity"}</button>
        <button type="button" className="rounded-md px-4 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
