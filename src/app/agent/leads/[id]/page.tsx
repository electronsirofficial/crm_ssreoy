import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { leadForUser } from "@/lib/access";
import { formatPhone } from "@/lib/phone";
import { Badge, Card, KV, PageHeader, ScoreBar, fmtDate, humanize } from "@/components/ui";
import { FollowUpForm, FollowUpRow, StageForm, Timeline, stageTone } from "@/components/lead-parts";
import { aiConfigured } from "@/lib/ai/claude";
import { refreshInsightAction } from "@/app/actions/ai";

export default async function AgentLead({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const { id } = await params;
  const { done } = await searchParams;
  const base = await leadForUser(user, id);
  if (!base) notFound();
  const [lead, stages] = await Promise.all([
    prisma.lead.findUniqueOrThrow({
      where: { id },
      include: {
        calls: { where: { agentId: user.id }, orderBy: { calledAt: "desc" } },
        visits: { where: { agentId: user.id }, include: { questionnaire: { select: { id: true } } }, orderBy: { checkInAt: "desc" } },
        followUps: { where: { status: "PENDING" }, orderBy: { dueAt: "asc" } },
      },
    }),
    prisma.leadStage.findMany({ orderBy: { order: "asc" } }),
  ]);
  const closed = ["ENROLLED", "LOST"].includes(lead.stageKey);

  return (
    <>
      <PageHeader
        title={lead.studentName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <a href={`tel:+91${lead.phone}`} className="link">
              {formatPhone(lead.phone)}
            </a>
            <Badge tone={stageTone(stages, lead.stageKey)}>{stages.find((s) => s.key === lead.stageKey)?.label}</Badge>
          </span>
        }
      />
      {done === "visit" && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Visit and questionnaire saved. Thank you!</div>}

      {!closed && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Link href={`/agent/leads/${lead.id}/call`} className="btn-primary py-3">
            📞 Log a call
          </Link>
          <Link href={`/agent/visit/new?lead=${lead.id}`} className="btn-primary bg-violet-600 py-3 hover:bg-violet-700">
            📍 Start home visit
          </Link>
        </div>
      )}

      <div className="space-y-4">
        {(lead.aiNextAction || aiConfigured()) && (
          <Card
            title="AI recommendation"
            actions={
              aiConfigured() && (
                <form action={refreshInsightAction}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button className="text-xs text-brand-600 hover:underline">Refresh</button>
                </form>
              )
            }
          >
            {lead.aiNextAction ? (
              <>
                <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                  Conversion likelihood <ScoreBar value={lead.aiConversion} />
                </div>
                <p className="text-sm whitespace-pre-line">{lead.aiNextAction}</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">No recommendation yet — tap Refresh after logging a call or visit.</p>
            )}
          </Card>
        )}

        <Card title="Details">
          <KV
            items={[
              ["Parent", lead.parentName],
              ["Class / exam", `${lead.classLevel ?? "?"} · ${lead.targetExam}`],
              ["School", lead.school],
              ["Locality", lead.locality],
              ["Address", lead.address],
              ["Source", humanize(lead.source)],
              ["Notes", lead.notes],
            ]}
          />
        </Card>

        <Card title="Follow-ups">
          {lead.followUps.map((f) => (
            <FollowUpRow key={f.id} f={f} />
          ))}
          {!closed && (
            <div className="mt-3">
              <FollowUpForm leadId={lead.id} />
            </div>
          )}
        </Card>

        {!closed && (
          <Card title="Stage">
            <StageForm leadId={lead.id} current={lead.stageKey} />
          </Card>
        )}

        <Card title={`My calls (${lead.calls.length})`}>
          {lead.calls.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {lead.calls.map((c) => (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">{fmtDate(c.calledAt)}</span>
                    {c.durationSec && <span className="text-slate-500">{Math.round(c.durationSec / 60)} min</span>}
                    <Badge tone={c.analysisStatus === "DONE" ? "green" : c.analysisStatus === "FAILED" ? "red" : "slate"}>AI: {humanize(c.analysisStatus)}</Badge>
                    {c.qualityScore != null && <ScoreBar value={c.qualityScore} />}
                  </div>
                  {c.summary && <p className="mt-1 text-xs text-slate-600">{c.summary}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No calls logged.</p>
          )}
        </Card>

        <Card title={`My visits (${lead.visits.length})`}>
          {lead.visits.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {lead.visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="tabular-nums">{fmtDate(v.checkInAt)}</span>
                  <Badge tone={v.status === "COMPLETED" ? "green" : v.status === "IN_PROGRESS" ? "violet" : "slate"}>{humanize(v.status)}</Badge>
                  {v.durationMin != null && <span className="text-slate-500">{v.durationMin} min</span>}
                  {v.status === "IN_PROGRESS" && (
                    <Link href={`/agent/visit/${v.id}`} className="link">
                      Check out
                    </Link>
                  )}
                  {v.status === "COMPLETED" && !v.questionnaire && (
                    <Link href={`/agent/visit/${v.id}/questionnaire`} className="link text-amber-700">
                      Fill questionnaire
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No visits recorded.</p>
          )}
        </Card>

        <Card title="History">
          <Timeline leadId={lead.id} />
        </Card>
      </div>
    </>
  );
}
