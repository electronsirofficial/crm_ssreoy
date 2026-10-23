import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { agentStats, parseRange } from "@/lib/stats";
import { aiConfigured } from "@/lib/ai/claude";
import type { AgentInsight } from "@/lib/ai/insights";
import { agentInsightAction } from "@/app/actions/ai";
import { resetPasswordAction } from "@/app/actions/admin";
import { Badge, Card, PageHeader, ScoreBar, Stat, fmtDate, inr } from "@/components/ui";
import { FlagItem } from "@/components/FlagItem";

export default async function AgentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const agent = await prisma.user.findUnique({ where: { id } });
  if (!agent) notFound();
  const { from, to } = parseRange(await searchParams);
  const [all, insightRow, flags, calls, visits] = await Promise.all([
    agentStats(from, to),
    prisma.setting.findUnique({ where: { key: `agent-insight:${id}` } }),
    prisma.fraudFlag.findMany({ where: { agentId: id }, include: { lead: { select: { studentName: true } }, reviewedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.call.findMany({ where: { agentId: id }, include: { lead: { select: { id: true, studentName: true } } }, orderBy: { calledAt: "desc" }, take: 10 }),
    prisma.fieldVisit.findMany({ where: { agentId: id }, include: { lead: { select: { id: true, studentName: true } } }, orderBy: { checkInAt: "desc" }, take: 10 }),
  ]);
  const s = all.find((x) => x.id === id);
  const insight = insightRow?.value as (AgentInsight & { at: string }) | undefined;

  return (
    <>
      <PageHeader title={agent.name} subtitle={`${agent.email} · last 30 days unless filtered`} />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <Stat label="Leads" value={s.leads} />
          <Stat label="Calls" value={s.calls} hint={s.avgQuality != null ? `avg quality ${s.avgQuality}` : undefined} />
          <Stat label="Visits" value={s.visits} hint={s.avgVisitMin != null ? `avg ${s.avgVisitMin} min` : undefined} />
          <Stat label="Admissions" value={s.enrollments} hint={s.conversionRate != null ? `${s.conversionRate}% conversion` : undefined} tone="green" />
          <Stat label="Overdue follow-ups" value={s.overdueFollowUps} tone={s.overdueFollowUps ? "red" : undefined} />
          <Stat label="Commission" value={inr(s.commissionApproved)} hint={s.commissionPending ? `${inr(s.commissionPending)} pending` : undefined} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="AI coaching & integrity review"
          actions={
            aiConfigured() && (
              <form action={agentInsightAction}>
                <input type="hidden" name="agentId" value={id} />
                <button className="text-xs text-brand-600 hover:underline">{insight ? "Refresh" : "Generate"}</button>
              </form>
            )
          }
        >
          {insight ? (
            <div className="space-y-3 text-sm">
              <p>{insight.overallAssessment}</p>
              <div>
                <div className="label">Strengths</div>
                <ul className="list-disc pl-5">{insight.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <div>
                <div className="label">Coaching</div>
                <ul className="list-disc pl-5">{insight.coachingTips.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <div>
                <div className="label">
                  Integrity risk <Badge tone={insight.integrityRisk === "HIGH" ? "red" : insight.integrityRisk === "MEDIUM" ? "amber" : "green"}>{insight.integrityRisk}</Badge>
                </div>
                <ul className="list-disc pl-5">{insight.integrityReasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <p className="text-xs text-slate-400">Generated {fmtDate(insight.at)}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{aiConfigured() ? "Click Generate for an AI review of this agent's last 30 days." : "Set ANTHROPIC_API_KEY to enable AI reviews."}</p>
          )}
        </Card>

        <Card title="Flags">{flags.length ? flags.map((f) => <FlagItem key={f.id} f={f} showLead />) : <p className="text-sm text-slate-500">No flags.</p>}</Card>

        <Card title="Recent calls">
          <ul className="divide-y divide-slate-100 text-sm">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/admin/calls/${c.id}`} className="link">
                    {fmtDate(c.calledAt)}
                  </Link>{" "}
                  · {c.lead.studentName}
                </span>
                <ScoreBar value={c.qualityScore} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Recent visits">
          <ul className="divide-y divide-slate-100 text-sm">
            {visits.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/admin/visits/${v.id}`} className="link">
                    {fmtDate(v.checkInAt)}
                  </Link>{" "}
                  · {v.lead.studentName} · {v.durationMin ?? "?"} min
                </span>
                <ScoreBar value={v.verificationScore} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Reset password">
          <form action={resetPasswordAction} className="flex gap-2">
            <input type="hidden" name="userId" value={id} />
            <input name="password" minLength={8} required placeholder="New password" className="input" />
            <button className="btn-secondary">Set</button>
          </form>
        </Card>
      </div>
    </>
  );
}
