import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mapsLink, osmEmbed } from "@/lib/geo";
import { Badge, Card, KV, PageHeader, ScoreBar, fmtDate, humanize } from "@/components/ui";
import { FlagItem } from "@/components/FlagItem";

type Check = { check: string; label: string; weight: number; passed: boolean | null; detail: string };

export default async function VisitDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN"]);
  const v = await prisma.fieldVisit.findUnique({ where: { id: (await params).id }, include: { agent: true, lead: true, questionnaire: true } });
  if (!v) notFound();
  const [flags, questions, history] = await Promise.all([
    prisma.fraudFlag.findMany({ where: { visitId: v.id }, include: { agent: { select: { name: true } }, reviewedBy: { select: { name: true } } } }),
    prisma.questionnaireQuestion.findMany({ orderBy: { order: "asc" } }),
    prisma.fieldVisit.findMany({ where: { leadId: v.leadId, id: { not: v.id } }, include: { agent: { select: { name: true } } }, orderBy: { checkInAt: "desc" } }),
  ]);
  const checks = (v.verificationNotes as Check[] | null) ?? [];
  const answers = (v.questionnaire?.answers as Record<string, unknown> | undefined) ?? {};

  return (
    <>
      <PageHeader
        title={`Visit · ${v.lead.studentName}`}
        subtitle={`${v.agent.name} · ${fmtDate(v.checkInAt)}`}
        actions={
          <Link href={`/admin/leads/${v.leadId}`} className="btn-secondary">
            Open lead
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Check-in photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${v.photoPath}`} alt="Check-in" className="w-full rounded-lg" />
              <p className="mt-2 text-xs break-all text-slate-500">sha256 {v.photoHash.slice(0, 16)}… · perceptual {v.photoDHash ?? "—"}</p>
            </Card>
            <Card title="Location">
              <iframe title="map" src={osmEmbed(v.checkInLat, v.checkInLng)} className="aspect-square w-full rounded-lg border-0" loading="lazy" />
              <a href={mapsLink(v.checkInLat, v.checkInLng)} target="_blank" rel="noreferrer" className="link mt-2 inline-block text-xs">
                Open in Google Maps
              </a>
            </Card>
          </div>

          <Card title={<span className="flex items-center gap-3">Verification checks <ScoreBar value={v.verificationScore} /></span>}>
            <ul className="divide-y divide-slate-100">
              {checks.map((c) => (
                <li key={c.check} className="flex items-start gap-3 py-2 text-sm">
                  <span className="w-5 text-center">{c.passed === null ? "⏳" : c.passed ? "✅" : "❌"}</span>
                  <div className="flex-1">
                    <div className="font-medium">
                      {c.label} <span className="text-xs font-normal text-slate-400">weight {c.weight}</span>
                    </div>
                    <div className="text-xs text-slate-600">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Questionnaire">
            {v.questionnaire ? (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  Submitted {fmtDate(v.questionnaire.submittedAt)} · took {v.questionnaire.fillSeconds}s · {v.questionnaire.completeness}% complete
                </p>
                <KV
                  items={questions
                    .filter((q) => answers[q.key] !== undefined)
                    .map((q) => {
                      const a = answers[q.key];
                      return [q.text, Array.isArray(a) ? a.join(", ") : typeof a === "boolean" ? (a ? "Yes" : "No") : String(a)] as [string, string];
                    })}
                />
              </>
            ) : (
              <p className="text-sm text-amber-700">Not submitted.</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Timing & GPS">
            <KV
              items={[
                ["Status", <Badge key="s">{humanize(v.status)}</Badge>],
                ["Check-in (server)", fmtDate(v.checkInAt)],
                ["Check-in (device)", fmtDate(v.checkInClientAt)],
                ["Check-out (server)", fmtDate(v.checkOutAt)],
                ["Duration", v.durationMin != null ? `${v.durationMin} min` : "—"],
                ["Check-in point", `${v.checkInLat.toFixed(6)}, ${v.checkInLng.toFixed(6)}`],
                ["Accuracy", v.checkInAccuracy ? `±${Math.round(v.checkInAccuracy)} m` : "—"],
                ["Check-out point", v.checkOutLat ? `${v.checkOutLat.toFixed(6)}, ${v.checkOutLng?.toFixed(6)}` : "—"],
                ["In/out drift", v.checkInOutDriftM != null ? `${v.checkInOutDriftM} m` : "—"],
                ["From family's home", v.distanceFromHomeM != null ? `${v.distanceFromHomeM} m` : "—"],
                ["Device", <span key="ua" className="text-xs break-all">{v.userAgent ?? "—"}</span>],
                ["IP", v.ipAddress],
              ]}
            />
          </Card>
          {flags.length > 0 && <Card title="Flags">{flags.map((f) => <FlagItem key={f.id} f={f} />)}</Card>}
          {history.length > 0 && (
            <Card title="Other visits to this family">
              <ul className="space-y-1 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <Link href={`/admin/visits/${h.id}`} className="link">
                      {fmtDate(h.checkInAt)}
                    </Link>{" "}
                    · {h.agent.name} · {h.durationMin ?? "?"} min
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
