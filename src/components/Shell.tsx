import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { NavLink } from "./NavLink";

type NavItem = { href: string; label: string; badge?: number };

export function Shell({ user, nav, children, narrow }: { user: { name: string; role: string }; nav: NavItem[]; children: ReactNode; narrow?: boolean }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className={`mx-auto flex items-center gap-4 px-4 py-2.5 ${narrow ? "max-w-3xl" : "max-w-7xl"}`}>
          <Link href="/" className="shrink-0 text-sm font-bold tracking-tight text-brand-700">
            Admissions CRM
          </Link>
          <nav className="hidden flex-1 items-center gap-1 overflow-x-auto md:flex">
            {nav.map((n) => (
              <NavLink key={n.href} {...n} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {user.name} <span className="text-xs text-slate-400">· {user.role.toLowerCase()}</span>
            </span>
            <form action={logout}>
              <button className="text-xs text-slate-500 hover:text-slate-900">Sign out</button>
            </form>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 md:hidden">
          {nav.map((n) => (
            <NavLink key={n.href} {...n} />
          ))}
        </nav>
      </header>
      <main className={`mx-auto px-4 py-6 ${narrow ? "max-w-3xl" : "max-w-7xl"}`}>{children}</main>
    </div>
  );
}
