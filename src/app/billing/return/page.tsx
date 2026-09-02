"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Flutterwave's hosted-checkout redirect appends `?resp=<url-encoded JSON>`,
// not a plain `tx_ref` param — a real gotcha Mongozutu's integration hit
// first (see the [[mongozutu-deployment]] memory). Handle both shapes
// defensively rather than assuming the newer one is guaranteed forever.
function extractTxRef(searchParams: URLSearchParams): string | null {
  const plain = searchParams.get("tx_ref");
  if (plain) return plain;

  const resp = searchParams.get("resp");
  if (resp) {
    try {
      const parsed = JSON.parse(decodeURIComponent(resp));
      return parsed.tx_ref ?? parsed.data?.tx_ref ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export default function BillingReturnPage() {
  return (
    <Suspense>
      <BillingReturnInner />
    </Suspense>
  );
}

function BillingReturnInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "completed" | "failed" | "error">("verifying");
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const txRef = extractTxRef(searchParams);
    if (!txRef) {
      setStatus("error");
      setError("No transaction reference found in the return URL.");
      return;
    }

    fetch("/api/billing/credits/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txRef }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setStatus("error");
          setError(body.error ?? "Verification failed.");
          return;
        }
        if (body.status === "completed") {
          setStatus("completed");
          setCredits(body.credits);
        } else {
          setStatus("failed");
        }
      })
      .catch(() => {
        setStatus("error");
        setError("Could not reach the server to verify this payment.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
        {status === "verifying" && <p className="text-sm text-neutral-500">Verifying your payment…</p>}
        {status === "completed" && (
          <>
            <p className="text-lg font-semibold text-neutral-900">Payment confirmed</p>
            <p className="text-sm text-neutral-600">{credits?.toLocaleString()} AI credits added to your account.</p>
          </>
        )}
        {status === "failed" && (
          <p className="text-sm text-red-600">This payment did not complete successfully. No credits were added.</p>
        )}
        {status === "error" && <p className="text-sm text-red-600">{error}</p>}
        <Link href="/billing" className="text-sm text-neutral-900 underline">Back to billing</Link>
      </div>
    </main>
  );
}
