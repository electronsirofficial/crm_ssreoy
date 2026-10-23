import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, Empty, PageHeader, ScoreBar, fmtDate, humanize } from "@/components/ui";

export default async function AdminFollowUps({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  await requireUser(["ADMIN"]);
  const { agent } = await searchParams;
  const now = new Date();
  const [pending, agents, untouched] = await Promise.all([
    prisma.followUp.findMany({
      where: { status: "PENDING", ...(agent ? { agentId: agent } : {}) },
      include: { lead: { select: { id: true, studentName: true, aiConversion: true } }, agent: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
      take: 500,
    }),
    prisma.user.findMany({ where: { role: "AGENT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Open leads with no follow-up planned at all.
    prisma.lead.findMany({
      where: { stageKey: { notIn: ["ENROLLED", "LOST"] }, nextFollowUpAt: null, ...(agent ? { assignedToId: agent } : {}) },
      include: { assignedTo: { select: { name: true } } },
      orderBy: [{ aiConversion: { sort: "desc", nulls: "last" } }],
      take: 50,
    }),
  ]);
  const overdue = pending.filter((f) => f.dueAt < now);
  const byAgent = new Map<string, number>();
  for (const f of overdue) byAgent.set(f.agent.name, (byAgent.get(f.agent.name) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Follow-ups"
        subtitle={`${overdue.length} overdue · ${pending.length - overdue.length} upcoming · ${untouched.length} open leads with nothing scheduled`}
        actions={
          <form className="flex gap-2">
            <select name="agent" defaultValue={agent ?? ""} className="input w-auto">
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button className="btn-secondary">Filter</button>
          </form>
        }
      />
      {byAgent.size > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[...byAgent.entries()].map(([name, n]) => (
            <Badge key={name} tone="red">
              {name}: {n} overdue
            </Badge>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scheduled">
          {pending.length ? (
            <div className="-mx-4 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>Lead</th>
                    <th>Agent</th>
                    <th>Type</th>
                    <th>AI conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((f) => (
                    <tr key={f.id}>
                      <td className={`text-xs whitespace-nowrap ${f.dueAt < now ? "font-medium text-red-600" : ""}`}>{fmtDate(f.dueAt)}</td>
                      <td className="text-sm">
                        <Link href={`/admin/leads/${f.lead.id}`} className="link">
                          {f.lead.studentName}
                        </Link>
                        {f.notes && <div className="text-xs text-slate-500">{f.notes}</div>}
                      </td>
                      <td className="text-sm">{f.agent.name}</td>
                      <td>
                        <Badge>{humanize(f.type)}</Badge>
                      </td>
                      <td>
                        <ScoreBar value={f.lead.aiConversion} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No follow-ups scheduled</Empty>
          )}
        </Card>
        <Card title="Open leads without a next step">
          {untouched.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {untouched.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <Link href={`/admin/leads/${l.id}`} className="link">
                      {l.studentName}
                    </Link>{" "}
                    <span className="text-xs text-slate-500">{l.assignedTo?.name ?? "unassigned"}</span>
                  </span>
                  <ScoreBar value={l.aiConversion} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Every open lead has a follow-up planned</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
