import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, Empty, PageHeader } from "@/components/ui";
import { FollowUpRow } from "@/components/lead-parts";

export default async function AgentFollowUps() {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const [pending, recent] = await Promise.all([
    prisma.followUp.findMany({ where: { agentId: user.id, status: "PENDING" }, include: { lead: true }, orderBy: { dueAt: "asc" } }),
    prisma.followUp.findMany({ where: { agentId: user.id, status: { not: "PENDING" } }, include: { lead: true }, orderBy: { completedAt: "desc" }, take: 20 }),
  ]);
  const now = new Date();
  const overdue = pending.filter((f) => f.dueAt < now);
  const upcoming = pending.filter((f) => f.dueAt >= now);
  return (
    <>
      <PageHeader title="Follow-ups" subtitle={`${overdue.length} overdue · ${upcoming.length} upcoming`} />
      <div className="space-y-4">
        <Card title={`Overdue (${overdue.length})`}>
          {overdue.length ? overdue.map((f) => <FollowUpRow key={f.id} f={f} showLead="/agent/leads" />) : <Empty>Nothing overdue</Empty>}
        </Card>
        <Card title={`Upcoming (${upcoming.length})`}>
          {upcoming.length ? upcoming.map((f) => <FollowUpRow key={f.id} f={f} showLead="/agent/leads" />) : <Empty>No upcoming follow-ups</Empty>}
        </Card>
        <Card title="Recently completed">
          {recent.length ? recent.map((f) => <FollowUpRow key={f.id} f={f} showLead="/agent/leads" />) : <Empty>None yet</Empty>}
        </Card>
      </div>
    </>
  );
}
