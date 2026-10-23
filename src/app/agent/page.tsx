import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pendingQuestionnaires } from "@/lib/visits";
import { Card, Empty, PageHeader, ScoreBar, Stat, fmtDate } from "@/components/ui";
import { FollowUpRow } from "@/components/lead-parts";

export default async function AgentToday() {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const endOfDay = new Date(Date.now() + 864e5);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [openVisit, pendingQ, due, hot, myCalls, myVisits, myCommissions] = await Promise.all([
    prisma.fieldVisit.findFirst({ where: { agentId: user.id, status: "IN_PROGRESS" }, include: { lead: true } }),
    pendingQuestionnaires(user.id),
    prisma.followUp.findMany({ where: { agentId: user.id, status: "PENDING", dueAt: { lt: endOfDay } }, include: { lead: true }, orderBy: { dueAt: "asc" } }),
    prisma.lead.findMany({
      where: { assignedToId: user.id, stageKey: { notIn: ["ENROLLED", "LOST"] }, aiConversion: { not: null } },
      orderBy: [{ aiPriority: "desc" }, { aiConversion: "desc" }],
      take: 5,
    }),
    prisma.call.count({ where: { agentId: user.id, calledAt: { gte: monthStart } } }),
    prisma.fieldVisit.count({ where: { agentId: user.id, checkInAt: { gte: monthStart } } }),
    prisma.commission.findMany({ where: { agentId: user.id, status: { in: ["APPROVED", "PAID", "PENDING_REVIEW"] } }, select: { status: true, amount: true } }),
  ]);
  const earned = myCommissions.filter((c) => c.status !== "PENDING_REVIEW").reduce((a, c) => a + c.amount, 0);
  const pendingAmt = myCommissions.filter((c) => c.status === "PENDING_REVIEW").reduce((a, c) => a + c.amount, 0);

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} subtitle="Your work for today" />

      {openVisit && (
        <Link href={`/agent/visit/${openVisit.id}`} className="card mb-4 block border-violet-300 bg-violet-50 p-4">
          <div className="text-xs font-semibold text-violet-700 uppercase">Visit in progress</div>
          <div className="mt-1 font-medium">{openVisit.lead.studentName}</div>
          <div className="text-sm text-slate-600">Checked in {fmtDate(openVisit.checkInAt)} — tap to check out</div>
        </Link>
      )}

      {pendingQ.length > 0 && (
        <div className="card mb-4 border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-800">Questionnaire required before your next visit</div>
          <ul className="mt-2 space-y-1">
            {pendingQ.map((v) => (
              <li key={v.id}>
                <Link href={`/agent/visit/${v.id}/questionnaire`} className="link">
                  {v.lead.studentName} — visit on {fmtDate(v.checkInAt)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Calls this month" value={myCalls} />
        <Stat label="Visits this month" value={myVisits} />
        <Stat label="Commission earned" value={`₹${earned.toLocaleString("en-IN")}`} tone="green" />
        <Stat label="Pending approval" value={`₹${pendingAmt.toLocaleString("en-IN")}`} tone="amber" />
      </div>

      <div className="space-y-4">
        <Card title={`Follow-ups due (${due.length})`} actions={<Link href="/agent/followups" className="link text-xs">All</Link>}>
          {due.length ? due.map((f) => <FollowUpRow key={f.id} f={f} showLead="/agent/leads" />) : <Empty>Nothing due today 🎉</Empty>}
        </Card>

        <Card title="AI: leads to prioritise">
          {hot.length ? (
            <ul className="divide-y divide-slate-100">
              {hot.map((l) => (
                <li key={l.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/agent/leads/${l.id}`} className="link">
                      {l.studentName}
                    </Link>
                    <ScoreBar value={l.aiConversion} />
                  </div>
                  {l.aiNextAction && <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-slate-600">{l.aiNextAction}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>AI suggestions appear once your calls are analysed.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
