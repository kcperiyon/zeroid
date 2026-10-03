import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BrandMark } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";

/** Signed-in top bar. Renders nothing on login/signup/invite (no session). */
export async function AppHeader() {
  const user = await getCurrentUser();
  if (!user) return null;

  const link = "rounded-md px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white";

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-neutral-900">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/businesses" className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight text-white">Zeroid</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/businesses" className={link}>Businesses</Link>
          <Link href="/team" className={link}>Team</Link>
          <Link href="/billing" className={link}>Billing</Link>
          <Link href="/account" className={link}>Account</Link>
          <span className="mx-2 hidden h-5 w-px bg-white/20 sm:block" />
          <span className="hidden text-xs text-white/60 sm:block">{user.email}</span>
          <span className="ml-2 [&_button]:rounded-md [&_button]:border [&_button]:border-white/25 [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-sm [&_button]:font-medium [&_button]:text-white [&_button:hover]:bg-white/10">
            <LogoutButton />
          </span>
        </nav>
      </div>
    </header>
  );
}
