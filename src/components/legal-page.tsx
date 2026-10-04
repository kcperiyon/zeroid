import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

/** Plain public frame for policy pages (no sign-in needed). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <Link href="/login" className="mb-8 flex items-center gap-2.5">
        <BrandMark className="h-8 w-8" />
        <span className="text-lg font-semibold tracking-tight text-neutral-900">Zeroid</span>
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">Last updated {updated}</p>
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-neutral-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-neutral-900 [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </main>
  );
}
