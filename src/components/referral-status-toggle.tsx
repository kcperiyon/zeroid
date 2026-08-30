"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const OPTIONS = ["pending", "converted", "declined"] as const;

export function ReferralStatusToggle({ businessId, referralId, status }: { businessId: string; referralId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function setStatus(next: string) {
    setLoading(true);
    await fetch(`/api/businesses/${businessId}/referrals/${referralId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <select
      value={status}
      disabled={loading}
      onChange={(e) => setStatus(e.target.value)}
      className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
    >
      {OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
