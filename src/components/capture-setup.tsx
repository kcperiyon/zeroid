"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-100 p-3 text-xs leading-relaxed text-neutral-800">
      {children}
    </pre>
  );
}

export function CaptureSetup({
  businessId,
  baseUrl,
  publicKey,
  canManage,
}: {
  businessId: string;
  baseUrl: string;
  publicKey: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (publicKey && !confirm("Generating a new key stops the current form link and webhook URL from working. Continue?")) {
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/businesses/${businessId}/intake`, { method: "POST" });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  if (!publicKey) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Lead capture</h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          <p>
            Get a hosted form link, an embeddable form, and a webhook URL that any website, landing page or ad platform
            can post leads to — organic or paid.
          </p>
          {canManage ? (
            <button
              onClick={generate}
              disabled={loading}
              className="mt-3 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create my capture link"}
            </button>
          ) : (
            <p className="mt-2 text-neutral-500">Ask an owner or admin to create it.</p>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  const formUrl = `${baseUrl}/f/${publicKey}`;
  const endpoint = `${baseUrl}/api/intake/${publicKey}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Hosted form</h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          <p>Share this link anywhere (bio link, WhatsApp, email signature, a QR code):</p>
          <a href={formUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-medium text-neutral-900 underline">
            {formUrl}
          </a>
          <p className="mt-3">Or embed it on your own site:</p>
          <Code>{`<iframe src="${formUrl}" width="100%" height="560" style="border:0"></iframe>`}</Code>
          <p className="mt-3 text-xs text-neutral-500">
            Tag where a visitor came from by adding <code>?utm_campaign=spring-promo</code> to the link. Add{" "}
            <code>&amp;utm_medium=cpc</code> for traffic from an ad and the lead is recorded as <strong>paid</strong>.
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Webhook / API (for ads and other tools)</h2>
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
          <p>
            POST JSON to this URL from an ad platform, Zapier, Make, your website or your own code. The key can only
            create leads, so it is safe to put in a page.
          </p>
          <Code>{endpoint}</Code>
          <Code>{`curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Ada Obi","email":"ada@example.com","phone":"+2348012345678",
       "message":"Interested in the premium plan",
       "channel":"facebook","medium":"paid","campaign":"october-leadgen"}'`}</Code>
          <p className="mt-3 text-xs text-neutral-500">
            Fields: <code>name</code>, <code>email</code>, <code>phone</code> (email or phone required),{" "}
            <code>company</code>, <code>message</code>, <code>campaign</code>. <code>medium</code> is{" "}
            <code>organic</code> (default) or <code>paid</code>. <code>channel</code> is one of api, webhook, facebook,
            instagram, google, tiktok, linkedin, email. A repeat email or phone adds to the existing lead instead of
            creating a duplicate.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Facebook / Instagram Lead Ads can also arrive directly — connect your Page on the Social tab.
          </p>
        </div>
      </div>

      {canManage && (
        <div>
          <button onClick={generate} disabled={loading} className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50">
            Generate a new key (invalidates the links above)
          </button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
