"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEXT_STATUS: Record<string, string | null> = {
  draft: "approved",
  approved: "published",
  published: null,
};

export function ContentStatusToggle({ businessId, contentId, status }: { businessId: string; contentId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const next = NEXT_STATUS[status];
  if (!next) return <span className="text-xs text-neutral-400">published</span>;

  async function advance() {
    setLoading(true);
    await fetch(`/api/businesses/${businessId}/content/${contentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={advance}
      disabled={loading}
      className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
    >
      Mark {next}
    </button>
  );
}
