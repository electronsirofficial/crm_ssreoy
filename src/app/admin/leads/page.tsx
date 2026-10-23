import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { Badge, Empty, PageHeader, ScoreBar, fmtDate, humanize } from "@/components/ui";
import { stageTone } from "@/components/lead-parts";

type SP = { q?: string; agent?: string; source?: string; stage?: string; from?: string; to?: string; admitted?: string; sort?: string };

export default async function AdminLeads({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const where: Prisma.LeadWhereInput = {
    ...(sp.agent ? (sp.agent === "none" ? { assignedToId: null } : { assignedToId: sp.agent }) : {}),
    ...(sp.source ? { source: sp.source as Prisma.EnumLeadSourceFilter["equals"] } : {}),
    ...(sp.stage ? { stageKey: sp.stage } : {}),
    ...(sp.admitted === "yes" ? { enrollment: { isNot: null } } : sp.admitted === "no" ? { enrollment: null } : {}),
    ...(sp.from || sp.to
      ? { createdAt: { ...(sp.from ? { gte: new Date(sp.from + "T00:00:00+05:30") } : {}), ...(sp.to ? { lte: new Date(sp.to + "T23:59:59+05:30") } : {}) } }
      : {}),
    ...(sp.q
      ? {
          OR: [
            { studentName: { contains: sp.q, mode: "insensitive" } },
            { parentName: { contains: sp.q, mode: "insensitive" } },
            { phone: { contains: sp.q.replace(/\D/g, "") || sp.q } },
            { locality: { contains: sp.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.LeadOrderByWithRelationInput[] =
    sp.sort === "priority" ? [{ aiPriority: { sort: "desc", nulls: "last" } }] : sp.sort === "followup" ? [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }] : [{ createdAt: "desc" }];

  const [leads, count, agents, stages] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy,
      take: 300,
      include: {
        assignedTo: { select: { name: true } },
        createdBy: { select: { name: true } },
        enrollment: { select: { id: true } },
        commissions: { select: { status: true, attribution: true }, take: 1, orderBy: { createdAt: "desc" } },
        _count: { select: { calls: true, visits: true, flags: { where: { status: "OPEN" } } } },
      },
    }),
    prisma.lead.count({ where }),
    prisma.user.findMany({ where: { role: "AGENT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.leadStage.findMany({ orderBy: { order: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Leads" subtitle={`${count} matching${count > leads.length ? ` (showing ${leads.length})` : ""}`} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-4 lg:grid-cols-8">
        <input name="q" defaultValue={sp.q} placeholder="Name, phone, locality" className="input lg:col-span-2" />
        <select name="agent" defaultValue={sp.agent ?? ""} className="input">
          <option value="">All agents</option>
          <option value="none">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className="input">
          <option value="">All sources</option>
          {["OUTBOUND_CALL", "FIELD_VISIT", "WALK_IN", "REFERRAL", "OTHER"].map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
        <select name="stage" defaultValue={sp.stage ?? ""} className="input">
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="admitted" defaultValue={sp.admitted ?? ""} className="input">
          <option value="">Admission: any</option>
          <option value="yes">Admitted</option>
          <option value="no">Not admitted</option>
        </select>
        <select name="sort" defaultValue={sp.sort ?? ""} className="input">
          <option value="">Newest</option>
          <option value="priority">AI priority</option>
          <option value="followup">Next follow-up</option>
        </select>
        <button className="btn-secondary">Filter</button>
        <input type="date" name="from" defaultValue={sp.from} className="input" title="Created from" />
        <input type="date" name="to" defaultValue={sp.to} className="input" title="Created to" />
      </form>

      {leads.length ? (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Source</th>
                <th>Assigned</th>
                <th>Stage</th>
                <th>Activity</th>
                <th>AI conv.</th>
                <th>Next follow-up</th>
                <th>Commission</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/admin/leads/${l.id}`} className="link">
                      {l.studentName}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {formatPhone(l.phone)} · {l.targetExam}
                    </div>
                  </td>
                  <td>
                    <Badge tone={l.source === "WALK_IN" ? "orange" : "slate"}>{humanize(l.source)}</Badge>
                  </td>
                  <td className="text-sm">{l.assignedTo?.name ?? <span className="text-slate-400">—</span>}</td>
                  <td>
                    <Badge tone={stageTone(stages, l.stageKey)}>{stages.find((s) => s.key === l.stageKey)?.label ?? l.stageKey}</Badge>
                  </td>
                  <td className="text-xs whitespace-nowrap text-slate-600">
                    {l._count.calls} calls · {l._count.visits} visits
                    {l._count.flags > 0 && (
                      <span className="ml-1">
                        <Badge tone="red">{l._count.flags} flag</Badge>
                      </span>
                    )}
                  </td>
                  <td>
                    <ScoreBar value={l.aiConversion} />
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    <span className={l.nextFollowUpAt && l.nextFollowUpAt < new Date() ? "font-medium text-red-600" : ""}>{fmtDate(l.nextFollowUpAt)}</span>
                  </td>
                  <td>{l.commissions[0] ? <Badge tone={l.commissions[0].status === "DISPUTED" ? "red" : l.commissions[0].status === "NOT_ELIGIBLE" ? "slate" : "green"}>{humanize(l.commissions[0].attribution)}</Badge> : "—"}</td>
                  <td className="text-xs whitespace-nowrap text-slate-500">
                    {fmtDate(l.createdAt, false)}
                    <div>{l.createdBy?.name}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No leads match these filters</Empty>
      )}
    </>
  );
}
