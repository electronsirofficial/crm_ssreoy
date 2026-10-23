import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { pendingQuestionnaires } from "@/lib/visits";

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const [pendingQ, overdue] = await Promise.all([
    pendingQuestionnaires(user.id),
    prisma.followUp.count({ where: { agentId: user.id, status: "PENDING", dueAt: { lt: new Date() } } }),
  ]);
  return (
    <Shell
      user={user}
      narrow
      nav={[
        { href: "/agent", label: "Today", badge: pendingQ.length },
        { href: "/agent/leads", label: "My leads" },
        { href: "/agent/leads/new", label: "+ New lead" },
        { href: "/agent/followups", label: "Follow-ups", badge: overdue },
        ...(user.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
      ]}
    >
      {children}
    </Shell>
  );
}
