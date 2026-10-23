import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Empty, PageHeader, ScoreBar, fmtDate } from "@/components/ui";
import { stageTone } from "@/components/lead-parts";
import { formatPhone } from "@/lib/phone";

export default async function AgentLeads({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string }> }) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const { q, stage } = await searchParams;
  const [stages, leads] = await Promise.all([
    prisma.leadStage.findMany({ orderBy: { order: "asc" } }),
    prisma.lead.findMany({
      where: {
        assignedToId: user.id,
        ...(stage ? { stageKey: stage } : {}),
        ...(q ? { OR: [{ studentName: { contains: q, mode: "insensitive" } }, { parentName: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } : {}),
      },
      orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    }),
  ]);
  return (
    <>
      <PageHeader title="My leads" subtitle={`${leads.length} shown`} actions={<Link href="/agent/leads/new" className="btn-primary">+ New lead</Link>} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name or phone" className="input" />
        <select name="stage" defaultValue={stage ?? ""} className="input w-auto">
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      {leads.length ? (
        <ul className="card divide-y divide-slate-100">
          {leads.map((l) => (
            <li key={l.id}>
              <Link href={`/agent/leads/${l.id}`} className="flex items-center gap-3 p-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{l.studentName}</div>
                  <div className="text-xs text-slate-500">
                    {formatPhone(l.phone)} · {l.classLevel ?? "class ?"} · {l.targetExam}
                    {l.nextFollowUpAt && <> · next: {fmtDate(l.nextFollowUpAt)}</>}
                  </div>
                </div>
                <ScoreBar value={l.aiConversion} />
                <Badge tone={stageTone(stages, l.stageKey)}>{stages.find((s) => s.key === l.stageKey)?.label ?? l.stageKey}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No leads yet. Add your first prospect.</Empty>
      )}
    </>
  );
}
