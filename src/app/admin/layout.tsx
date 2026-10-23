import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["ADMIN"]);
  const [openHigh, toReview] = await Promise.all([
    prisma.fraudFlag.count({ where: { status: "OPEN", severity: "HIGH" } }),
    prisma.commission.count({ where: { status: { in: ["PENDING_REVIEW", "DISPUTED"] } } }),
  ]);
  return (
    <Shell
      user={user}
      nav={[
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/leads", label: "Leads" },
        { href: "/admin/calls", label: "Calls" },
        { href: "/admin/visits", label: "Visits" },
        { href: "/admin/followups", label: "Follow-ups" },
        { href: "/admin/flags", label: "Flags", badge: openHigh },
        { href: "/admin/commissions", label: "Commissions", badge: toReview },
        { href: "/admin/agents", label: "Team" },
        { href: "/admin/settings", label: "Settings" },
        { href: "/admin/audit", label: "Audit" },
        { href: "/desk", label: "Front desk" },
      ]}
    >
      {children}
    </Shell>
  );
}
