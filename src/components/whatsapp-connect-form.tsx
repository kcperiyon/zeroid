"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Connected = {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  accessTokenMasked: string;
};

export function WhatsAppConnectForm({ businessId, connected }: { businessId: string; connected: Connected | null }) {
  const router = useRouter();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/businesses/${businessId}/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumberId, wabaId, displayPhoneNumber: displayPhoneNumber || undefined, accessToken }),
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

  async function handleDisconnect() {
    setLoading(true);
    await fetch(`/api/businesses/${businessId}/whatsapp`, { method: "DELETE" });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">WhatsApp connection</h2>
        {connected ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm font-medium text-neutral-900">Connected</p>
            <dl className="mt-2 space-y-1 text-sm text-neutral-600">
              <div><dt className="inline text-neutral-400">Number: </dt><dd className="inline">{connected.displayPhoneNumber ?? connected.phoneNumberId}</dd></div>
              <div><dt className="inline text-neutral-400">Phone number ID: </dt><dd className="inline">{connected.phoneNumberId}</dd></div>
              <div><dt className="inline text-neutral-400">WABA ID: </dt><dd className="inline">{connected.wabaId}</dd></div>
              <div><dt className="inline text-neutral-400">Access token: </dt><dd className="inline">{connected.accessTokenMasked}</dd></div>
            </dl>
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="mt-3 rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Not connected yet — add the details below.</p>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
        <p className="font-medium text-neutral-800">Webhook URL for Meta&apos;s App dashboard</p>
        <p className="mt-1">
          Prepend this app&apos;s domain to <code className="rounded bg-neutral-100 px-1 py-0.5">/api/webhooks/whatsapp</code> and
          set it in Meta App → WhatsApp → Configuration, with the verify token from{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>. Subscribe to the{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5">messages</code> field.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="space-y-1">
          <label htmlFor="wa-phone-id" className="text-sm font-medium text-neutral-700">Phone number ID</label>
          <input
            id="wa-phone-id"
            required
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            placeholder="from Meta Business Suite → WhatsApp accounts → your number"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="wa-waba-id" className="text-sm font-medium text-neutral-700">WhatsApp Business Account ID</label>
          <input
            id="wa-waba-id"
            required
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="wa-display" className="text-sm font-medium text-neutral-700">Display number (optional)</label>
          <input
            id="wa-display"
            value={displayPhoneNumber}
            onChange={(e) => setDisplayPhoneNumber(e.target.value)}
            placeholder="+234 707 296 3805"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="wa-token" className="text-sm font-medium text-neutral-700">Access token</label>
          <input
            id="wa-token"
            required
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="a permanent system-user token, not the 24h temporary one"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? "Saving…" : connected ? "Update connection" : "Connect"}
        </button>
      </form>
    </div>
  );
}
