"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "./ui";
import { SegmentBuilder, type SegmentFilterValues } from "./segment-builder";

export function SegmentRow({
  businessId,
  segment,
}: {
  businessId: string;
  segment: { id: string; name: string; size: number; filter: SegmentFilterValues };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Delete the segment "${segment.name}"?`)) return;
    const res = await fetch(`/api/businesses/${businessId}/segments/${segment.id}`, { method: "DELETE" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not delete.");
    router.refresh();
  }

  if (editing) {
    return (
      <li className="py-3">
        <SegmentBuilder businessId={businessId} segment={segment} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-neutral-800">{segment.name}</span>
        <span className="flex items-center gap-3">
          <span className="text-neutral-500">{segment.size} lead{segment.size === 1 ? "" : "s"} with an email</span>
          <button className="text-xs font-medium text-neutral-500 hover:text-neutral-900" onClick={() => setEditing(true)}>Edit</button>
          <button className="text-xs font-medium text-red-600 hover:underline" onClick={remove}>Delete</button>
        </span>
      </div>
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </li>
  );
}
