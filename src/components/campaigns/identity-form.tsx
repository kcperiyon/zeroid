"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, Field, inputClass, Notice } from "./ui";

export type PublicIdentity = {
  id: string;
  name: string;
  provider: "brevo_shared" | "smtp";
  fromEmail: string;
  fromName: string;
  replyToEmail: string | null;
  physicalAddress: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  dkimDomain: string | null;
  dkimSelector: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  imapUser: string | null;
  imapFolder: string;
  dailyCap: number;
  perDomainHourlyCap: number;
  hasSmtpPassword: boolean;
  hasDkimKey: boolean;
  hasImapPassword: boolean;
};

type Props = { businessId: string; canManage: boolean; identity?: PublicIdentity; onDone?: () => void };

export function IdentityForm({ businessId, canManage, identity, onDone }: Props) {
  const router = useRouter();
  const editing = Boolean(identity);
  const [open, setOpen] = useState(editing);
  const [provider, setProvider] = useState<"brevo_shared" | "smtp">(identity?.provider ?? "brevo_shared");
  const [v, setV] = useState({
    name: identity?.name ?? "",
    fromEmail: identity?.fromEmail ?? "",
    fromName: identity?.fromName ?? "",
    replyToEmail: identity?.replyToEmail ?? "",
    physicalAddress: identity?.physicalAddress ?? "",
    dailyCap: String(identity?.dailyCap ?? 20),
    perDomainHourlyCap: String(identity?.perDomainHourlyCap ?? 5),
    smtpHost: identity?.smtpHost ?? "",
    smtpPort: String(identity?.smtpPort ?? 587),
    smtpUser: identity?.smtpUser ?? "",
    smtpPass: "",
    smtpSecure: identity?.smtpSecure ?? false,
    dkimDomain: identity?.dkimDomain ?? "",
    dkimSelector: identity?.dkimSelector ?? "",
    dkimPrivateKey: "",
    imapHost: identity?.imapHost ?? "",
    imapPort: String(identity?.imapPort ?? 993),
    imapUser: identity?.imapUser ?? "",
    imapPass: "",
    imapSecure: identity?.imapSecure ?? true,
    imapFolder: identity?.imapFolder ?? "INBOX",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const keepHint = (has: boolean) => (editing && has ? "Saved. Leave blank to keep it." : undefined);

  if (!canManage) return editing ? null : <p className="text-sm text-neutral-500">Ask an owner or admin to add a sending identity.</p>;
  if (!open) return <button className={buttonClass} onClick={() => setOpen(true)}>+ Add sending identity</button>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: v.name, provider, fromEmail: v.fromEmail, fromName: v.fromName,
      replyToEmail: v.replyToEmail, physicalAddress: v.physicalAddress,
      dailyCap: Number(v.dailyCap) || 20, perDomainHourlyCap: Number(v.perDomainHourlyCap) || 5,
      imapHost: v.imapHost || undefined, imapPort: v.imapHost ? Number(v.imapPort) || undefined : undefined,
      imapUser: v.imapUser || undefined, imapPass: v.imapPass || undefined, imapSecure: v.imapSecure, imapFolder: v.imapFolder || undefined,
    };
    if (provider === "smtp") {
      Object.assign(body, {
        smtpHost: v.smtpHost, smtpPort: Number(v.smtpPort) || undefined, smtpSecure: v.smtpSecure,
        smtpUser: v.smtpUser || undefined, smtpPass: v.smtpPass || undefined,
        dkimDomain: v.dkimDomain || undefined, dkimSelector: v.dkimSelector || undefined, dkimPrivateKey: v.dkimPrivateKey || undefined,
      });
    }
    const res = await fetch(
      editing ? `/api/businesses/${businessId}/identities/${identity!.id}` : `/api/businesses/${businessId}/identities`,
      { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    setLoading(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
      return;
    }
    if (!editing) setOpen(false);
    onDone?.();
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Emails per day (warms up over 14 days)"><input type="number" min={1} max={5000} className={inputClass} value={v.dailyCap} onChange={set("dailyCap")} /></Field>
        <Field label="Max per recipient domain per hour"><input type="number" min={1} max={500} className={inputClass} value={v.perDomainHourlyCap} onChange={set("perDomainHourlyCap")} /></Field>
      </div>

      {provider === "smtp" && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
          <p className="text-sm font-medium text-neutral-700">Sending server (SMTP)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SMTP host"><input required className={inputClass} value={v.smtpHost} onChange={set("smtpHost")} /></Field>
            <Field label="Port"><input className={inputClass} value={v.smtpPort} onChange={set("smtpPort")} /></Field>
            <Field label="Username"><input className={inputClass} value={v.smtpUser} onChange={set("smtpUser")} autoComplete="off" /></Field>
            <Field label="Password" hint={keepHint(identity?.hasSmtpPassword ?? false)}>
              <input type="password" className={inputClass} value={v.smtpPass} onChange={set("smtpPass")} autoComplete="new-password" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={v.smtpSecure} onChange={(e) => setV((s) => ({ ...s, smtpSecure: e.target.checked }))} /> Use implicit TLS (port 465)
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="DKIM domain"><input className={inputClass} value={v.dkimDomain} onChange={set("dkimDomain")} placeholder="mail.example.com" /></Field>
            <Field label="DKIM selector"><input className={inputClass} value={v.dkimSelector} onChange={set("dkimSelector")} placeholder="zeroid1" /></Field>
          </div>
          <Field label="DKIM private key (PEM)" hint={keepHint(identity?.hasDkimKey ?? false)}>
            <textarea rows={3} className={inputClass} value={v.dkimPrivateKey} onChange={set("dkimPrivateKey")} />
          </Field>
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
        <p className="text-sm font-medium text-neutral-700">Reply mailbox (optional)</p>
        <p className="text-xs text-neutral-500">
          Zeroid can read replies and bounces from this inbox (read-only, nothing is changed or deleted) so a reply stops the sequence and
          an interested reply becomes a task. Gmail and Yahoo need an app password.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="IMAP host"><input className={inputClass} value={v.imapHost} onChange={set("imapHost")} placeholder="imap.gmail.com" /></Field>
          <Field label="Port"><input className={inputClass} value={v.imapPort} onChange={set("imapPort")} /></Field>
          <Field label="Username"><input className={inputClass} value={v.imapUser} onChange={set("imapUser")} autoComplete="off" /></Field>
          <Field label="Password / app password" hint={keepHint(identity?.hasImapPassword ?? false)}>
            <input type="password" className={inputClass} value={v.imapPass} onChange={set("imapPass")} autoComplete="new-password" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={v.imapSecure} onChange={(e) => setV((s) => ({ ...s, imapSecure: e.target.checked }))} /> Use TLS (port 993)
        </label>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <button className={buttonClass} disabled={loading}>{loading ? "Saving…" : editing ? "Save changes" : "Save identity"}</button>
        <button type="button" className="rounded-md px-4 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100" onClick={() => (editing ? onDone?.() : setOpen(false))}>Cancel</button>
      </div>
    </form>
  );
}
