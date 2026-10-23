"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const path = usePathname();
  const root = href.split("/").length <= 2;
  const active = root ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap ${
        active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
      {badge ? <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{badge}</span> : null}
    </Link>
  );
}
