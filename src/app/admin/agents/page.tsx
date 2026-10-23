import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { agentStats, parseRange } from "@/lib/stats";
import { toggleUserAction } from "@/app/actions/admin";
import { Badge, Card, PageHeader, ScoreBar, inr } from "@/components/ui";
import { DateRange } from "@/components/DateRange";
import { CreateUserForm } from "./CreateUserForm";

export default async function Team({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const me = await requireUser(["ADMIN"]);
  const { from, to, fromStr, toStr } = parseRange(await searchParams);
  const [stats, users] = await Promise.all([agentStats(from, to), prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] })]);
  const best = (k: keyof (typeof stats)[number]) => Math.max(0, ...stats.map((s) => Number(s[k] ?? 0)));

  return (
    <>
      <PageHeader title="Team" subtitle="Compare agents over a period" actions={<DateRange from={fromStr} to={toStr} />} />
      <Card title="Agent comparison">
        <div className="-mx-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Leads</th>
                <th>Calls</th>
                <th>Call quality</th>
                <th>Visits</th>
                <th>Avg visit</th>
                <th>Verification</th>
                <th>Q. owed</th>
                <th>Admissions</th>
                <th>Conversion</th>
                <th>Overdue</th>
                <th>Open flags</th>
                <th>Commission</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                  <td>
                    <Link href={`/admin/agents/${s.id}`} className="link">
                      {s.name}
                    </Link>
                  </td>
                  <td className={`tabular-nums ${s.leads === best("leads") && s.leads ? "font-semibold text-emerald-700" : ""}`}>{s.leads}</td>
                  <td className={`tabular-nums ${s.calls === best("calls") && s.calls ? "font-semibold text-emerald-700" : ""}`}>{s.calls}</td>
                  <td>
                    <ScoreBar value={s.avgQuality} />
                  </td>
                  <td className={`tabular-nums ${s.visits === best("visits") && s.visits ? "font-semibold text-emerald-700" : ""}`}>{s.visits}</td>
                  <td className="tabular-nums">{s.avgVisitMin != null ? `${s.avgVisitMin} min` : "—"}</td>
                  <td>
                    <ScoreBar value={s.avgVerification} />
                  </td>
                  <td className={`tabular-nums ${s.questionnairePending ? "text-amber-700" : ""}`}>{s.questionnairePending}</td>
                  <td className={`tabular-nums ${s.enrollments === best("enrollments") && s.enrollments ? "font-semibold text-emerald-700" : ""}`}>{s.enrollments}</td>
                  <td className="tabular-nums">{s.conversionRate != null ? `${s.conversionRate}%` : "—"}</td>
                  <td className={`tabular-nums ${s.overdueFollowUps ? "text-red-600" : ""}`}>{s.overdueFollowUps}</td>
                  <td>{s.openFlags ? <Badge tone={s.highFlags ? "red" : "amber"}>{s.openFlags}</Badge> : "0"}</td>
                  <td className="text-xs whitespace-nowrap">
                    {inr(s.commissionApproved)}
                    {s.commissionPending > 0 && <div className="text-amber-700">+{inr(s.commissionPending)} pending</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Users">
          <ul className="divide-y divide-slate-100 text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {u.name} <span className="text-xs text-slate-500">{u.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={u.role === "ADMIN" ? "blue" : u.role === "RECEPTION" ? "orange" : "slate"}>{u.role.toLowerCase()}</Badge>
                  {u.id !== me.id && (
                    <form action={toggleUserAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <button className={`text-xs ${u.active ? "text-red-600" : "text-emerald-700"} hover:underline`}>{u.active ? "Deactivate" : "Activate"}</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Add user">
          <CreateUserForm />
        </Card>
      </div>
    </>
  );
}
