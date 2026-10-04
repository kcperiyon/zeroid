"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string };

export function BusinessTabs({ tabs, baseHref }: { tabs: Tab[]; baseHref: string }) {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex flex-wrap gap-x-0.5 border-b border-neutral-200">
      {tabs.map((tab) => {
        // The first tab (Products) lives at the base path, so match it exactly;
        // every other tab owns its sub-path.
        const active = tab.href === baseHref ? pathname === baseHref : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              "-mb-px shrink-0 border-b-2 px-2.5 pb-2.5 pt-1 text-sm font-medium transition-colors " +
              (active
                ? "border-brand-500 text-neutral-900"
                : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-900")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
