import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseRange } from "@/lib/stats";
import { Badge, Empty, PageHeader, ScoreBar, fmtDate, humanize } from "@/components/ui";

export default async function AdminCalls({ searchParams }: { searchParams: Promise<{ agent?: string; from?: string; to?: string; q?: string; quality?: string }> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = parseRange(sp);
  const issueIds =
    sp.quality === "issues"
      ? (await prisma.fraudFlag.findMany({ where: { type: { in: ["CALL_DISCREPANCY", "CALL_INTEGRITY"] }, callId: { not: null } }, select: { callId: true } })).map((f) => f.callId!)
      : [];
  const where: Prisma.CallWhereInput = {
    calledAt: { gte: from, lte: to },
    ...(sp.agent ? { agentId: sp.agent } : {}),
    ...(sp.quality === "low" ? { qualityScore: { lt: 50 } } : sp.quality === "high" ? { qualityScore: { gte: 70 } } : sp.quality === "issues" ? { id: { in: issueIds } } : {}),
    ...(sp.q ? { OR: [{ transcript: { contains: sp.q, mode: "insensitive" } }, { summary: { contains: sp.q, mode: "insensitive" } }, { lead: { studentName: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [calls, agents] = await Promise.all([
    prisma.call.findMany({ where, include: { agent: { select: { name: true } }, lead: { select: { id: true, studentName: true } } }, orderBy: { calledAt: "desc" }, take: 300 }),
    prisma.user.findMany({ where: { role: "AGENT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Calls" subtitle={`${calls.length} calls`} />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <input name="q" defaultValue={sp.q} placeholder="Search transcripts & summaries" className="input w-64" />
        <select name="agent" defaultValue={sp.agent ?? ""} className="input w-auto">
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select name="quality" defaultValue={sp.quality ?? ""} className="input w-auto">
          <option value="">Any quality</option>
          <option value="high">Good (70+)</option>
          <option value="low">Poor (&lt;50)</option>
          <option value="issues">Has discrepancies</option>
        </select>
        <input type="date" name="from" defaultValue={fromStr} className="input w-auto" />
        <input type="date" name="to" defaultValue={toStr} className="input w-auto" />
        <button className="btn-secondary">Filter</button>
      </form>
      {calls.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Agent</th>
                <th>Lead</th>
                <th>Length</th>
                <th>Quality</th>
                <th>Conversion</th>
                <th>Issues</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const disc = (c.discrepancies as unknown[] | null)?.length ?? 0;
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="text-xs whitespace-nowrap">
                      <Link href={`/admin/calls/${c.id}`} className="link">
                        {fmtDate(c.calledAt)}
                      </Link>
                    </td>
                    <td className="text-sm">{c.agent.name}</td>
                    <td className="text-sm">
                      <Link href={`/admin/leads/${c.lead.id}`} className="link">
                        {c.lead.studentName}
                      </Link>
                    </td>
                    <td className="text-sm tabular-nums">{c.durationSec ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : "—"}</td>
                    <td>{c.analysisStatus === "DONE" ? <ScoreBar value={c.qualityScore} /> : <Badge tone={c.analysisStatus === "FAILED" ? "red" : "slate"}>{humanize(c.analysisStatus)}</Badge>}</td>
                    <td>
                      <ScoreBar value={c.conversionScore} />
                    </td>
                    <td>{disc ? <Badge tone="red">{disc}</Badge> : <span className="text-slate-400">—</span>}</td>
                    <td className="max-w-sm text-xs text-slate-600">
                      <span className="line-clamp-2">{c.summary ?? c.reportedOutcome}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No calls in this period</Empty>
      )}
    </>
  );
}
