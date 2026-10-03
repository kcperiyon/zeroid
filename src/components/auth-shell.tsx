import { BrandMark } from "@/components/brand-mark";

/** Split-screen frame for login/signup: deep-blue brand panel + white form side. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-neutral-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="h-9 w-9" />
          <span className="text-xl font-semibold tracking-tight">Zeroid</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Find the right prospects. Qualify them automatically. Close more.
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-white/80">
            <li className="flex gap-3"><Tick />Prospect from organic channels, with room for paid leads too</li>
            <li className="flex gap-3"><Tick />Qualify and score every lead the moment it arrives</li>
            <li className="flex gap-3"><Tick />AI drafts the follow-up; your team stays in control</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/50">© Codes &amp; Bytes</p>
      </section>

      <section className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight text-neutral-900">Zeroid</span>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" fill="currentColor" aria-hidden="true">
      <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z" />
    </svg>
  );
}
