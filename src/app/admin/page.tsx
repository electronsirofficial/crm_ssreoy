import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { agentStats, parseRange } from "@/lib/stats";
import { maybeSweep } from "@/lib/intelligence";
import { FLAG_LABELS } from "@/lib/flags";
import { aiConfigured } from "@/lib/ai/claude";
import { transcriptionProvider } from "@/lib/transcribe";
import { Badge, Card, Empty, PageHeader, SEVERITY_TONE, ScoreBar, Stat, fmtDate, inr } from "@/components/ui";
import { DateRange } from "@/components/DateRange";

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser(["ADMIN"]);
  await maybeSweep().catch(() => undefined);
  const { from, to, fromStr, toStr } = parseRange(await searchParams);
  const range = { gte: from, lte: to };
  const now = new Date();

  const openFlagCount = await prisma.fraudFlag.count({ where: { status: "OPEN" } });
  const toReviewCount = await prisma.commission.count({ where: { status: { in: ["PENDING_REVIEW", "DISPUTED"] } } });
  const [stats, sourceSplit, enrollments, walkInEnrolled, overdue, flags, toReview, approvedSum, qPending, stages] = await Promise.all([
    agentStats(from, to),
    prisma.lead.groupBy({ by: ["source"], where: { createdAt: range }, _count: true }),
    prisma.enrollment.count({ where: { enrolledAt: range } }),
    prisma.commission.count({ where: { createdAt: range, attribution: "WALK_IN" } }),
    prisma.followUp.count({ where: { status: "PENDING", dueAt: { lt: now } } }),
    prisma.fraudFlag.findMany({ where: { status: "OPEN" }, include: { agent: { select: { name: true } }, lead: { select: { studentName: true } } }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }], take: 8 }), // enum order LOW<MEDIUM<HIGH
    prisma.commission.findMany({ where: { status: { in: ["PENDING_REVIEW", "DISPUTED"] } }, include: { lead: { select: { studentName: true } }, agent: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 8 }),
    prisma.commission.aggregate({ where: { status: { in: ["APPROVED", "PAID"] }, decidedAt: range }, _sum: { amount: true } }),
    prisma.fieldVisit.count({ where: { status: "COMPLETED", questionnaire: null } }),
    prisma.lead.groupBy({ by: ["stageKey"], _count: true }),
  ]);
  const totalLeads = sourceSplit.reduce((a, s) => a + s._count, 0);
  const walkIns = sourceSplit.find((s) => s.source === "WALK_IN")?._count ?? 0;
  const agentLeads = totalLeads - walkIns;
  const totals = stats.reduce((a, s) => ({ calls: a.calls + s.calls, visits: a.visits + s.visits }), { calls: 0, visits: 0 });
  const stageLabels = await prisma.leadStage.findMany({ orderBy: { order: "asc" } });
  const maxStage = Math.max(1, ...stages.map((s) => s._count));

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${fmtDate(from, false)} – ${fmtDate(to, false)}`} actions={<DateRange from={fromStr} to={toStr} />} />

      {(!aiConfigured() || transcriptionProvider() === "none") && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {!aiConfigured() && <div>AI call analysis is off — set <code>ANTHROPIC_API_KEY</code> in <code>.env</code>.</div>}
          {transcriptionProvider() === "none" && <div>Automatic transcription is off — set <code>TRANSCRIPTION_PROVIDER</code> and its API key (Deepgram or OpenAI).</div>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Calls" value={totals.calls} href="/admin/calls" />
        <Stat label="Field visits" value={totals.visits} href="/admin/visits" />
        <Stat label="New leads" value={totalLeads} hint={`${agentLeads} by agents · ${walkIns} walk-in`} href="/admin/leads" />
        <Stat label="Admissions" value={enrollments} hint={`${walkInEnrolled} direct walk-ins`} tone="green" />
        <Stat label="Overdue follow-ups" value={overdue} tone={overdue ? "red" : undefined} href="/admin/followups" />
        <Stat label="Questionnaires owed" value={qPending} tone={qPending ? "amber" : undefined} href="/admin/visits?q=pending" />
        <Stat label="Commission to review" value={toReviewCount} tone={toReviewCount ? "amber" : undefined} href="/admin/commissions" />
        <Stat label="Commission approved" value={inr(approvedSum._sum.amount ?? 0)} tone="green" href="/admin/commissions?status=APPROVED" />
        <Stat label="Open flags" value={openFlagCount}tone={flags.some((f) => f.severity === "HIGH") ? "red" : undefined} href="/admin/flags" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Commission decisions waiting" actions={<Link href="/admin/commissions" className="link text-xs">All</Link>}>
          {toReview.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {toReview.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/admin/leads/${c.leadId}#attribution`} className="link">
                    {c.lead.studentName}
                  </Link>
                  <span className="flex items-center gap-2 text-xs">
                    {c.agent?.name ?? "—"}
                    <Badge tone={c.status === "DISPUTED" ? "red" : "amber"}>{c.status === "DISPUTED" ? "Disputed" : "Pending"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No decisions pending</Empty>
          )}
        </Card>

        <Card title="Suspicious activity" actions={<Link href="/admin/flags" className="link text-xs">All</Link>}>
          {flags.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {flags.map((f) => (
                <li key={f.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                    <span className="font-medium">{FLAG_LABELS[f.type] ?? f.type}</span>
                    <span className="text-xs text-slate-500">{f.agent?.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    {f.message}
                    {f.leadId && (
                      <>
                        {" · "}
                        <Link href={`/admin/leads/${f.leadId}`} className="link">
                          {f.lead?.studentName}
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing suspicious right now</Empty>
          )}
        </Card>
      </div>

      <Card title="Agent performance" className="mt-4" actions={<Link href="/admin/agents" className="link text-xs">Team</Link>}>
        <div className="-mx-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Leads</th>
                <th>Calls</th>
                <th>Avg call quality</th>
                <th>Visits</th>
                <th>Avg visit</th>
                <th>Visit verification</th>
                <th>Admissions</th>
                <th>Conv.</th>
                <th>Overdue</th>
                <th>Flags</th>
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
                  <td className="tabular-nums">{s.leads}</td>
                  <td className="tabular-nums">{s.calls}</td>
                  <td>
                    <ScoreBar value={s.avgQuality} />
                  </td>
                  <td className="tabular-nums">{s.visits}</td>
                  <td className="tabular-nums">{s.avgVisitMin != null ? `${s.avgVisitMin} min` : "—"}</td>
                  <td>
                    <ScoreBar value={s.avgVerification} />
                  </td>
                  <td className="tabular-nums">{s.enrollments}</td>
                  <td className="tabular-nums">{s.conversionRate != null ? `${s.conversionRate}%` : "—"}</td>
                  <td className={`tabular-nums ${s.overdueFollowUps ? "font-medium text-red-600" : ""}`}>{s.overdueFollowUps}</td>
                  <td>{s.openFlags ? <Badge tone={s.highFlags ? "red" : "amber"}>{s.openFlags}</Badge> : <span className="text-slate-400">0</span>}</td>
                  <td className="text-xs whitespace-nowrap">
                    <div className="text-emerald-700">{inr(s.commissionApproved)}</div>
                    {s.commissionPending > 0 && <div className="text-amber-700">{inr(s.commissionPending)} pending</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Pipeline (all leads by stage)">
          <ul className="space-y-1.5 text-sm">
            {stageLabels.map((st) => {
              const n = stages.find((s) => s.stageKey === st.key)?._count ?? 0;
              return (
                <li key={st.key}>
                  <Link href={`/admin/leads?stage=${st.key}`} className="flex items-center gap-3 hover:opacity-80">
                    <span className="w-48 shrink-0 truncate text-slate-600">{st.label}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full bg-brand-600" style={{ width: `${(n / maxStage) * 100}%` }} />
                    </span>
                    <span className="w-8 text-right tabular-nums">{n}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Lead sources (period)">
          <ul className="space-y-1.5 text-sm">
            {sourceSplit.map((s) => (
              <li key={s.source} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-slate-600">{s.source.replace("_", " ").toLowerCase()}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className={`block h-full ${s.source === "WALK_IN" ? "bg-orange-500" : "bg-brand-600"}`} style={{ width: `${(s._count / Math.max(1, totalLeads)) * 100}%` }} />
                </span>
                <span className="w-8 text-right tabular-nums">{s._count}</span>
              </li>
            ))}
            {!sourceSplit.length && <Empty>No leads in this period</Empty>}
          </ul>
        </Card>
      </div>
    </>
  );
}
