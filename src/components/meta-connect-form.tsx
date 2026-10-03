"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Connected = {
  pageId: string;
  pageName: string | null;
  instagramLinked: boolean;
  subscribed: boolean;
  tokenMasked: string;
};

const input =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";

export function MetaConnectForm({
  businessId,
  webhookUrl,
  canManage,
  connected,
}: {
  businessId: string;
  webhookUrl: string;
  canManage: boolean;
  connected: Connected | null;
}) {
  const router = useRouter();
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/businesses/${businessId}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, pageAccessToken: token }),
    });
    const body = await res.json().catch(() => ({ error: "Something went wrong." }));
    setLoading(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    if (!body.subscribed) {
      setNotice(
        `Connected, but Meta would not subscribe this Page to the webhook yet: ${body.subscribeError}. ` +
          "Messages and comments won't arrive until that's resolved (usually missing app permissions)."
      );
    }
    setToken("");
    router.refresh();
  }

  async function handleDisconnect() {
    setLoading(true);
    await fetch(`/api/businesses/${businessId}/meta`, { method: "DELETE" });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Facebook &amp; Instagram</h2>
        {connected ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-sm font-medium text-neutral-900">
              Connected{connected.pageName ? ` — ${connected.pageName}` : ""}
            </p>
            <dl className="mt-2 space-y-1 text-sm text-neutral-600">
              <div><dt className="inline text-neutral-400">Page ID: </dt><dd className="inline">{connected.pageId}</dd></div>
              <div>
                <dt className="inline text-neutral-400">Instagram: </dt>
                <dd className="inline">{connected.instagramLinked ? "linked professional account found" : "no linked professional account"}</dd>
              </div>
              <div>
                <dt className="inline text-neutral-400">Webhook subscription: </dt>
                <dd className={"inline " + (connected.subscribed ? "text-green-700" : "text-red-600")}>
                  {connected.subscribed ? "active" : "not active — reconnect after fixing permissions"}
                </dd>
              </div>
              <div><dt className="inline text-neutral-400">Token: </dt><dd className="inline">{connected.tokenMasked}</dd></div>
            </dl>
            {canManage && (
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="mt-3 rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Not connected yet — add your Page details below.</p>
        )}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
        <p className="font-medium text-neutral-900">What this captures</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Messenger and Instagram DMs, and comments on your Page / Instagram posts, each become a lead (organic) with a task to reply.</li>
          <li>Facebook Lead Ad form submissions become leads tagged <strong>paid</strong>, with the campaign name.</li>
          <li>It never replies on its own — a person answers.</li>
        </ul>
        <p className="mt-3 font-medium text-neutral-900">One-time setup in the Meta app</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            In your Meta app → Webhooks, add the <strong>Page</strong> and <strong>Instagram</strong> objects with
            callback URL <code className="rounded bg-neutral-100 px-1 py-0.5">{webhookUrl}</code> and the same verify
            token used for WhatsApp.
          </li>
          <li>
            Subscribe to the fields: Page → <code>messages</code>, <code>feed</code>, <code>leadgen</code>;
            Instagram → <code>messages</code>, <code>comments</code>.
          </li>
          <li>
            Generate a Page access token that can read messages and leads (permissions such as{" "}
            <code>pages_messaging</code>, <code>pages_manage_metadata</code>, <code>pages_read_engagement</code>,{" "}
            <code>leads_retrieval</code>, <code>instagram_basic</code>, <code>instagram_manage_messages</code>,{" "}
            <code>instagram_manage_comments</code>) and paste it below with the Page ID.
          </li>
        </ol>
        <p className="mt-3 text-neutral-500">
          Until Meta approves the app for those permissions (App Review), this only works for people with a role on the
          app — enough to test with your own Page.
        </p>
      </div>

      {canManage && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="space-y-1">
            <label htmlFor="meta-page" className="text-sm font-medium text-neutral-700">Facebook Page ID</label>
            <input id="meta-page" required value={pageId} onChange={(e) => setPageId(e.target.value)} className={input} />
          </div>
          <div className="space-y-1">
            <label htmlFor="meta-token" className="text-sm font-medium text-neutral-700">Page access token</label>
            <input
              id="meta-token"
              required
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="a long-lived Page token"
              className={input}
            />
            <p className="text-xs text-neutral-400">Checked against Meta before it is saved. Your Instagram account is found automatically if it is linked to the Page.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-amber-700">{notice}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Checking with Meta…" : connected ? "Update connection" : "Connect"}
          </button>
        </form>
      )}
    </div>
  );
}
