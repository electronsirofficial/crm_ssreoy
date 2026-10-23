import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeAttribution } from "@/lib/attribution";
import { formatPhone } from "@/lib/phone";
import { aiConfigured } from "@/lib/ai/claude";
import { reassignLeadAction, recomputeAttributionAction } from "@/app/actions/admin";
import { refreshInsightAction } from "@/app/actions/ai";
import { Badge, Card, KV, PageHeader, ScoreBar, fmtDate, humanize, inr } from "@/components/ui";
import { FollowUpForm, FollowUpRow, StageForm, Timeline, stageTone } from "@/components/lead-parts";
import { AttributionView } from "@/components/attribution-panel";
import { FlagItem } from "@/components/FlagItem";

export default async function AdminLead({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: true,
      createdBy: true,
      enrollment: { include: { recordedBy: { select: { name: true } } } },
      calls: { include: { agent: { select: { name: true } } }, orderBy: { calledAt: "desc" } },
      visits: { include: { agent: { select: { name: true } }, questionnaire: true }, orderBy: { checkInAt: "desc" } },
      followUps: { include: { agent: { select: { name: true } } }, orderBy: { dueAt: "desc" }, take: 20 },
      claims: { include: { agent: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      flags: { include: { agent: { select: { name: true } }, reviewedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      commissions: { include: { agent: { select: { id: true, name: true } }, decidedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!lead) notFound();
  const [stages, agents, declared, questions] = await Promise.all([
    prisma.leadStage.findMany({ orderBy: { order: "asc" } }),
    prisma.user.findMany({ where: { role: "AGENT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    lead.walkInDeclaredAgentId ? prisma.user.findUnique({ where: { id: lead.walkInDeclaredAgentId }, select: { name: true } }) : null,
    prisma.questionnaireQuestion.findMany({ orderBy: { order: "asc" } }),
  ]);
  const commission = lead.commissions[0] ?? null;
  const preview = commission ? null : await computeAttribution(lead.id);
  const pendingFollowUps = lead.followUps.filter((f) => f.status === "PENDING");
  const latestQ = lead.visits.find((v) => v.questionnaire)?.questionnaire;

  return (
    <>
      <PageHeader
        title={lead.studentName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {formatPhone(lead.phone)}
            <Badge tone={stageTone(stages, lead.stageKey)}>{stages.find((s) => s.key === lead.stageKey)?.label}</Badge>
            <Badge tone={lead.source === "WALK_IN" ? "orange" : "slate"}>{humanize(lead.source)}</Badge>
            {lead.enrollment && <Badge tone="green">Enrolled</Badge>}
          </span>
        }
        actions={
          <Link href={`/admin/leads?q=${lead.phone}`} className="btn-secondary">
            Back to leads
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={<span id="attribution">Attribution &amp; commission</span>}
            actions={
              commission &&
              !commission.decidedById && (
                <form action={recomputeAttributionAction}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button className="text-xs text-brand-600 hover:underline">Recompute</button>
                </form>
              )
            }
          >
            <AttributionView stored={commission} preview={preview} agents={agents} />
          </Card>

          <Card title={`Calls (${lead.calls.length})`}>
            {lead.calls.length ? (
              <div className="-mx-4 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Agent</th>
                      <th>Length</th>
                      <th>Quality</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lead.calls.map((c) => (
                      <tr key={c.id}>
                        <td className="text-xs whitespace-nowrap">
                          <Link href={`/admin/calls/${c.id}`} className="link">
                            {fmtDate(c.calledAt)}
                          </Link>
                        </td>
                        <td className="text-sm">{c.agent.name}</td>
                        <td className="text-sm tabular-nums">{c.durationSec ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : "—"}</td>
                        <td>{c.analysisStatus === "DONE" ? <ScoreBar value={c.qualityScore} /> : <Badge>{humanize(c.analysisStatus)}</Badge>}</td>
                        <td className="max-w-md text-xs text-slate-600">{c.summary ?? c.reportedOutcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No calls.</p>
            )}
          </Card>

          <Card title={`Home visits (${lead.visits.length})`}>
            {lead.visits.length ? (
              <div className="-mx-4 overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Check-in</th>
                      <th>Agent</th>
                      <th>Duration</th>
                      <th>Verification</th>
                      <th>Questionnaire</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lead.visits.map((v) => (
                      <tr key={v.id}>
                        <td className="text-xs whitespace-nowrap">
                          <Link href={`/admin/visits/${v.id}`} className="link">
                            {fmtDate(v.checkInAt)}
                          </Link>
                        </td>
                        <td className="text-sm">{v.agent.name}</td>
                        <td className="text-sm tabular-nums">{v.durationMin != null ? `${v.durationMin} min` : humanize(v.status)}</td>
                        <td>
                          <ScoreBar value={v.verificationScore} />
                        </td>
                        <td>{v.questionnaire ? <Badge tone="green">{v.questionnaire.fillSeconds}s</Badge> : <Badge tone="amber">Missing</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No visits.</p>
            )}
          </Card>

          {latestQ && (
            <Card title="Latest questionnaire answers">
              <KV
                items={questions
                  .filter((q) => (latestQ.answers as Record<string, unknown>)[q.key] !== undefined)
                  .map((q) => {
                    const v = (latestQ.answers as Record<string, unknown>)[q.key];
                    return [q.text, Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)] as [string, string];
                  })}
              />
            </Card>
          )}

          <Card title={`Flags (${lead.flags.length})`}>
            {lead.flags.length ? lead.flags.map((f) => <FlagItem key={f.id} f={f} />) : <p className="text-sm text-slate-500">No flags.</p>}
          </Card>

          <Card title="Audit trail">
            <Timeline leadId={lead.id} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <KV
              items={[
                ["Parent", lead.parentName],
                ["Class / exam", `${lead.classLevel ?? "?"} · ${lead.targetExam}`],
                ["School", lead.school],
                ["Locality", lead.locality],
                ["Address", lead.address],
                ["Created", `${fmtDate(lead.createdAt)} by ${lead.createdBy?.name ?? "—"}`],
                ["At institute", fmtDate(lead.walkInAt)],
                ["Family mentioned", declared?.name ?? (lead.walkInAt ? "No agent" : "—")],
                ["Heard via", lead.walkInNotes],
                ["Enrollment", lead.enrollment ? `${lead.enrollment.course} · ${inr(lead.enrollment.feeAmount)} · ${fmtDate(lead.enrollment.enrolledAt, false)}` : "—"],
                ["Home location", lead.homeLat ? `${lead.homeLat.toFixed(5)}, ${lead.homeLng?.toFixed(5)}` : "Not yet verified"],
              ]}
            />
          </Card>

          <Card
            title="AI insight"
            actions={
              aiConfigured() && (
                <form action={refreshInsightAction}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button className="text-xs text-brand-600 hover:underline">Refresh</button>
                </form>
              )
            }
          >
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
              Conversion <ScoreBar value={lead.aiConversion} /> Priority <ScoreBar value={lead.aiPriority} />
            </div>
            <p className="text-sm whitespace-pre-line">{lead.aiNextAction ?? "No AI analysis yet."}</p>
            {lead.aiUpdatedAt && <p className="mt-2 text-xs text-slate-400">Updated {fmtDate(lead.aiUpdatedAt)}</p>}
          </Card>

          <Card title="Ownership">
            <div className="mb-2 text-sm">
              Assigned to <b>{lead.assignedTo?.name ?? "nobody"}</b>
            </div>
            <form action={reassignLeadAction} className="flex gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <select name="agentId" defaultValue={lead.assignedToId ?? ""} className="input">
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary">Reassign</button>
            </form>
            <p className="mt-2 text-xs text-slate-500">Assignment decides who works the lead. Commission is decided by evidence, not assignment.</p>
            {lead.claims.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
                {lead.claims.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>
                      {c.agent.name} <span className="text-slate-500">{c.kind === "CREATED" ? "created lead" : "tried to re-register"}</span>
                    </span>
                    <span className="text-slate-500">{fmtDate(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Stage">
            <StageForm leadId={lead.id} current={lead.stageKey} allowOffice />
          </Card>

          <Card title="Follow-ups">
            {pendingFollowUps.map((f) => (
              <FollowUpRow key={f.id} f={f} />
            ))}
            <div className="mt-3">
              <FollowUpForm leadId={lead.id} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
