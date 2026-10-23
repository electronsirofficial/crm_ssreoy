import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseRange } from "@/lib/stats";
import { getSettings } from "@/lib/settings";
import { Badge, Empty, PageHeader, ScoreBar, fmtDate, humanize } from "@/components/ui";

export default async function AdminVisits({ searchParams }: { searchParams: Promise<{ agent?: string; from?: string; to?: string; q?: string }> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = parseRange(sp);
  const s = await getSettings();
  const where: Prisma.FieldVisitWhereInput = {
    checkInAt: { gte: from, lte: to },
    ...(sp.agent ? { agentId: sp.agent } : {}),
    ...(sp.q === "pending" ? { status: "COMPLETED", questionnaire: null } : {}),
    ...(sp.q === "short" ? { durationMin: { lt: s.visit.minDurationMin } } : {}),
    ...(sp.q === "low" ? { verificationScore: { lt: s.visit.minVerificationScore } } : {}),
  };
  const [visits, agents] = await Promise.all([
    prisma.fieldVisit.findMany({
      where,
      include: { agent: { select: { name: true } }, lead: { select: { id: true, studentName: true, locality: true } }, questionnaire: { select: { fillSeconds: true } } },
      orderBy: { checkInAt: "desc" },
      take: 300,
    }),
    prisma.user.findMany({ where: { role: "AGENT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Field visits" subtitle={`${visits.length} visits`} />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <select name="agent" defaultValue={sp.agent ?? ""} className="input w-auto">
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select name="q" defaultValue={sp.q ?? ""} className="input w-auto">
          <option value="">All visits</option>
          <option value="pending">Questionnaire missing</option>
          <option value="short">Shorter than {s.visit.minDurationMin} min</option>
          <option value="low">Low verification score</option>
        </select>
        <input type="date" name="from" defaultValue={fromStr} className="input w-auto" />
        <input type="date" name="to" defaultValue={toStr} className="input w-auto" />
        <button className="btn-secondary">Filter</button>
      </form>
      {visits.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Check-in</th>
                <th>Agent</th>
                <th>Family</th>
                <th>Duration</th>
                <th>GPS ±</th>
                <th>Verification</th>
                <th>Questionnaire</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/admin/visits/${v.id}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/files/${v.photoPath}`} alt="" className="h-12 w-16 rounded object-cover" loading="lazy" />
                    </Link>
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    <Link href={`/admin/visits/${v.id}`} className="link">
                      {fmtDate(v.checkInAt)}
                    </Link>
                  </td>
                  <td className="text-sm">{v.agent.name}</td>
                  <td className="text-sm">
                    <Link href={`/admin/leads/${v.lead.id}`} className="link">
                      {v.lead.studentName}
                    </Link>
                    <div className="text-xs text-slate-500">{v.lead.locality}</div>
                  </td>
                  <td className={`text-sm tabular-nums ${v.durationMin != null && v.durationMin < s.visit.minDurationMin ? "font-medium text-red-600" : ""}`}>
                    {v.durationMin != null ? `${v.durationMin} min` : <Badge tone="violet">{humanize(v.status)}</Badge>}
                  </td>
                  <td className="text-xs tabular-nums">{v.checkInAccuracy ? `${Math.round(v.checkInAccuracy)} m` : "—"}</td>
                  <td>
                    <ScoreBar value={v.verificationScore} />
                  </td>
                  <td>{v.questionnaire ? <Badge tone="green">Done</Badge> : v.status === "COMPLETED" ? <Badge tone="amber">Missing</Badge> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No visits match</Empty>
      )}
    </>
  );
}
