import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reprocessCallAction } from "@/app/actions/ai";
import { Badge, Card, KV, PageHeader, ScoreBar, SEVERITY_TONE, fmtDate, humanize } from "@/components/ui";
import { FlagItem } from "@/components/FlagItem";

type Eval = { key: string; label: string; weight: number; score: number; comment: string }[];
type Disc = { agentClaim: string; transcriptEvidence: string; severity: "LOW" | "MEDIUM" | "HIGH" }[];
type Insights = {
  meaningfulConversation?: boolean;
  invitedToVisit?: boolean;
  visitCommitted?: boolean;
  spokeWith?: string;
  prospectInterest?: string;
  nextAction?: string;
  integrityConcerns?: string[];
  extracted?: { studentClass: string | null; targetExam: string; concerns: string[]; objections: string[] };
};

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN"]);
  const call = await prisma.call.findUnique({ where: { id: (await params).id }, include: { agent: true, lead: true } });
  if (!call) notFound();
  const flags = await prisma.fraudFlag.findMany({ where: { callId: call.id }, include: { agent: { select: { name: true } }, reviewedBy: { select: { name: true } } } });
  const evaluation = (call.evaluation as Eval | null) ?? [];
  const disc = (call.discrepancies as Disc | null) ?? [];
  const ai = (call.aiInsights as Insights | null) ?? {};
  const yes = (b?: boolean) => (b == null ? "—" : b ? "Yes" : "No");

  return (
    <>
      <PageHeader
        title={`Call · ${call.lead.studentName}`}
        subtitle={`${call.agent.name} · ${fmtDate(call.calledAt)} · ${call.phoneNumber}`}
        actions={
          <Link href={`/admin/leads/${call.leadId}`} className="btn-secondary">
            Open lead
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Recording">
            {call.recordingPath ? (
              <audio controls preload="none" src={`/api/files/${call.recordingPath}`} className="w-full" />
            ) : (
              <p className="text-sm text-slate-500">No recording uploaded (transcript entered manually — not counted as evidence).</p>
            )}
            <div className="mt-2 text-xs text-slate-500">
              Uploaded {fmtDate(call.createdAt)} · consent confirmed: {call.consentConfirmed ? "yes" : "no"}
              {call.recordingHash && <> · sha256 {call.recordingHash.slice(0, 12)}…</>}
            </div>
          </Card>

          <Card title="AI summary">
            {call.summary ? <p className="text-sm">{call.summary}</p> : <p className="text-sm text-slate-500">Not analysed. {call.analysisError ?? call.transcriptError}</p>}
          </Card>

          {evaluation.length > 0 && (
            <Card title={<span className="flex items-center gap-3">Evaluation <ScoreBar value={call.qualityScore} /></span>}>
              <ul className="space-y-2.5">
                {evaluation.map((e) => (
                  <li key={e.key}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">
                        {e.label} <span className="text-xs font-normal text-slate-400">weight {e.weight}</span>
                      </span>
                      <ScoreBar value={e.score} max={10} />
                    </div>
                    <p className="text-xs text-slate-600">{e.comment}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={`Report vs. recording (${disc.length} discrepancies)`}>
            <KV
              items={[
                ["Agent's outcome", call.reportedOutcome],
                ["Agent's interest", call.reportedInterest],
                ["Agent's notes", call.reportedNotes],
              ]}
            />
            {disc.length > 0 && (
              <ul className="mt-3 space-y-2">
                {disc.map((d, i) => (
                  <li key={i} className="rounded-lg border border-red-100 bg-red-50/50 p-2.5 text-sm">
                    <Badge tone={SEVERITY_TONE[d.severity]}>{d.severity}</Badge> <b>Claimed:</b> {d.agentClaim}
                    <div className="mt-1 text-slate-700">
                      <b>Transcript:</b> {d.transcriptEvidence}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Transcript">
            <pre className="max-h-[480px] overflow-auto text-sm whitespace-pre-wrap text-slate-800">{call.transcript ?? "No transcript."}</pre>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Status">
            <KV
              items={[
                ["Duration", call.durationSec ? `${Math.floor(call.durationSec / 60)}m ${call.durationSec % 60}s` : "—"],
                ["Transcription", humanize(call.transcriptStatus)],
                ["Analysis", humanize(call.analysisStatus)],
                ["Quality", call.qualityScore != null ? `${call.qualityScore}/100` : "—"],
                ["Conversion", call.conversionScore != null ? `${call.conversionScore}%` : "—"],
                ["Analysed", fmtDate(call.analyzedAt)],
              ]}
            />
            {(call.analysisError || call.transcriptError) && <p className="mt-2 text-xs text-red-600">{call.analysisError ?? call.transcriptError}</p>}
          </Card>

          <Card title="What the AI found">
            <KV
              items={[
                ["Real conversation", yes(ai.meaningfulConversation)],
                ["Spoke with", ai.spokeWith ? humanize(ai.spokeWith) : "—"],
                ["Invited to visit", yes(ai.invitedToVisit)],
                ["Visit committed", yes(ai.visitCommitted)],
                ["Interest", ai.prospectInterest ? humanize(ai.prospectInterest) : "—"],
                ["Class / exam", ai.extracted ? `${ai.extracted.studentClass ?? "?"} · ${ai.extracted.targetExam}` : "—"],
                ["Concerns", ai.extracted?.concerns.join(", ")],
                ["Objections", ai.extracted?.objections.join(", ")],
                ["Next action", ai.nextAction],
              ]}
            />
            {ai.integrityConcerns && ai.integrityConcerns.length > 0 && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-800">{ai.integrityConcerns.join(" · ")}</div>
            )}
          </Card>

          <Card title="Re-run analysis">
            <form action={reprocessCallAction} className="space-y-2">
              <input type="hidden" name="callId" value={call.id} />
              <textarea name="transcript" rows={4} placeholder="Optional: paste a corrected transcript" className="input" />
              <button className="btn-secondary w-full">Re-run transcription / AI analysis</button>
            </form>
          </Card>

          {flags.length > 0 && <Card title="Flags">{flags.map((f) => <FlagItem key={f.id} f={f} />)}</Card>}
        </div>
      </div>
    </>
  );
}
