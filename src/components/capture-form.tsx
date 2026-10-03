"use client";

import { useState, type FormEvent } from "react";

export function CaptureForm({
  publicKey,
  utmCampaign,
  utmMedium,
}: {
  publicKey: string;
  utmCampaign?: string;
  utmMedium?: string;
}) {
  const [values, setValues] = useState({ name: "", email: "", phone: "", message: "", website_url: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/intake/${publicKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, utm_campaign: utmCampaign, utm_medium: utmMedium }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setError(body.error ?? "Something went wrong.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center">
        <p className="text-base font-semibold text-neutral-900">Thank you</p>
        <p className="mt-1 text-sm text-neutral-500">We&apos;ve got your details and will be in touch.</p>
      </div>
    );
  }

  const input =
    "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
      <div className="space-y-1">
        <label htmlFor="cf-name" className="text-sm font-medium text-neutral-700">Name</label>
        <input id="cf-name" required value={values.name} onChange={set("name")} className={input} />
      </div>
      <div className="space-y-1">
        <label htmlFor="cf-email" className="text-sm font-medium text-neutral-700">Email</label>
        <input id="cf-email" type="email" value={values.email} onChange={set("email")} className={input} />
      </div>
      <div className="space-y-1">
        <label htmlFor="cf-phone" className="text-sm font-medium text-neutral-700">Phone / WhatsApp</label>
        <input id="cf-phone" value={values.phone} onChange={set("phone")} className={input} />
        <p className="text-xs text-neutral-400">Email or phone — at least one.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="cf-message" className="text-sm font-medium text-neutral-700">What are you looking for?</label>
        <textarea id="cf-message" rows={3} value={values.message} onChange={set("message")} className={input} />
      </div>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="cf-website">Website</label>
        <input id="cf-website" tabIndex={-1} autoComplete="off" value={values.website_url} onChange={set("website_url")} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
