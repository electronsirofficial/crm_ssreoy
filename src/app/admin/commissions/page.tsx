import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, COMMISSION_TONE, Empty, PageHeader, Stat, fmtDate, humanize, inr } from "@/components/ui";
import { CommissionDecisionForm } from "@/components/CommissionDecisionForm";

const TABS = [
  ["REVIEW", "Needs decision"],
  ["APPROVED", "Approved"],
  ["PAID", "Paid"],
  ["NOT_ELIGIBLE", "Not eligible"],
  ["REJECTED", "Rejected"],
  ["ALL", "All"],
] as const;

export default async function Commissions({ searchParams }: { searchParams: Promise<{ status?: string; agent?: string }> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const tab = sp.status ?? "REVIEW";
  const where: Prisma.CommissionWhereInput = {
    ...(tab === "REVIEW" ? { status: { in: ["PENDING_REVIEW", "DISPUTED"] } } : tab !== "ALL" ? { status: tab as Prisma.EnumCommissionStatusFilter["equals"] } : {}),
    ...(sp.agent ? { agentId: sp.agent } : {}),
  };
  const [rows, agents, totals] = await Promise.all([
    prisma.commission.findMany({
      where,
      include: { lead: { select: { id: true, studentName: true, source: true, enrollment: { select: { course: true, enrolledAt: true } } } }, agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.user.findMany({ where: { role: "AGENT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.commission.groupBy({ by: ["status"], _count: true, _sum: { amount: true } }),
  ]);
  const t = (s: string) => totals.find((x) => x.status === s);

  return (
    <>
      <PageHeader title="Commissions" subtitle="Every admission is attributed from evidence. You make the final call." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Pending review" value={(t("PENDING_REVIEW")?._count ?? 0) + (t("DISPUTED")?._count ?? 0)} hint={`${t("DISPUTED")?._count ?? 0} disputed`} tone="amber" />
        <Stat label="Approved (unpaid)" value={inr(t("APPROVED")?._sum.amount ?? 0)} tone="green" />
        <Stat label="Paid" value={inr(t("PAID")?._sum.amount ?? 0)} />
        <Stat label="Walk-ins / no evidence" value={t("NOT_ELIGIBLE")?._count ?? 0} hint="commission saved" />
        <Stat label="Rejected" value={t("REJECTED")?._count ?? 0} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/admin/commissions?status=${k}${sp.agent ? `&agent=${sp.agent}` : ""}`} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-brand-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
            {label}
          </Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="status" value={tab} />
          <select name="agent" defaultValue={sp.agent ?? ""} className="input w-auto py-1.5">
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn-secondary py-1.5">Filter</button>
        </form>
      </div>

      {rows.length ? (
        <div className="space-y-3">
          {rows.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/admin/leads/${c.lead.id}#attribution`} className="link text-base">
                    {c.lead.studentName}
                  </Link>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {c.lead.enrollment ? `${c.lead.enrollment.course} · enrolled ${fmtDate(c.lead.enrollment.enrolledAt, false)}` : "Not enrolled"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={COMMISSION_TONE[c.status]}>{humanize(c.status)}</Badge>
                  <Badge tone={c.attribution === "WALK_IN" ? "orange" : c.attribution === "CONTESTED" ? "red" : "blue"}>{humanize(c.attribution)}</Badge>
                  <span className="text-sm font-medium">{c.agent?.name ?? "No agent"}</span>
                  <span className="text-sm">{inr(c.amount)}</span>
                  <span className="text-xs text-slate-500">{c.confidence}% conf.</span>
                </div>
              </div>
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                {(c.reasoning as string[]).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {["PENDING_REVIEW", "DISPUTED", "APPROVED", "NOT_ELIGIBLE"].includes(c.status) && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <CommissionDecisionForm commissionId={c.id} status={c.status} suggestedAgentId={c.agent?.id ?? ""} amount={c.amount} agents={agents} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty>Nothing here</Empty>
      )}
    </>
  );
}
