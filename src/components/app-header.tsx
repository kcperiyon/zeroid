import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BrandMark } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";

/** Signed-in top bar. Renders nothing on login/signup/invite (no session). Wraps to two rows on phones. */
export async function AppHeader() {
  const user = await getCurrentUser();
  if (!user) return null;

  const link = "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white";

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-neutral-900">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
        <Link href="/businesses" className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight text-white">Zeroid</span>
        </Link>

        {/* Links: their own scrollable row on phones, inline from sm up. */}
        <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto pt-1 sm:order-none sm:mx-0 sm:ml-auto sm:w-auto sm:pt-0">
          <Link href="/businesses" className={link}>Businesses</Link>
          <Link href="/team" className={link}>Team</Link>
          <Link href="/billing" className={link}>Billing</Link>
          <Link href="/account" className={link}>Account</Link>
        </nav>

        <div className="flex items-center gap-2 sm:ml-2">
          <span className="hidden h-5 w-px bg-white/20 sm:block" />
          <span className="hidden text-xs text-white/60 sm:block">{user.email}</span>
          <span className="[&_button]:rounded-md [&_button]:border [&_button]:border-white/25 [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-sm [&_button]:font-medium [&_button]:text-white [&_button:hover]:bg-white/10">
            <LogoutButton />
          </span>
        </div>
      </div>
    </header>
  );
}
