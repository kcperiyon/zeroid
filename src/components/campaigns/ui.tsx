"use client";

import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-neutral-500 focus:outline-none";
export const buttonClass =
  "rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50";
export const ghostButtonClass =
  "rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

export function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-brand-100 text-brand-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>{status}</span>
  );
}

export function Notice({ tone, children }: { tone: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const tones = {
    info: "border-brand-100 bg-brand-50 text-neutral-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-800",
    ok: "border-green-200 bg-green-50 text-green-800",
  };
  return <div className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>{children}</div>;
}
