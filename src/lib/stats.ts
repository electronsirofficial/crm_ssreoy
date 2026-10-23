import { prisma } from "./db";

export type AgentStats = {
  id: string;
  name: string;
  active: boolean;
  leads: number;
  calls: number;
  avgQuality: number | null;
  visits: number;
  avgVisitMin: number | null;
  avgVerification: number | null;
  questionnairePending: number;
  enrollments: number; // enrollments attributed (approved/pending/paid)
  conversionRate: number | null; // attributed enrollments / leads created
  overdueFollowUps: number;
  openFlags: number;
  highFlags: number;
  commissionApproved: number;
  commissionPending: number;
};

/** Per-agent metrics for a period (calls/visits/leads counted inside the period; backlog counted now). */
export async function agentStats(from: Date, to: Date): Promise<AgentStats[]> {
  const agents = await prisma.user.findMany({ where: { role: "AGENT" }, orderBy: { name: "asc" } });
  const range = { gte: from, lte: to };
  const now = new Date();

  const [leads, calls, visits, qPending, commissions, overdue, flags] = await Promise.all([
    prisma.lead.groupBy({ by: ["createdById"], where: { createdAt: range, createdById: { not: null } }, _count: true }),
    prisma.call.groupBy({ by: ["agentId"], where: { calledAt: range }, _count: true, _avg: { qualityScore: true } }),
    prisma.fieldVisit.groupBy({ by: ["agentId"], where: { checkInAt: range, status: "COMPLETED" }, _count: true, _avg: { durationMin: true, verificationScore: true } }),
    prisma.fieldVisit.groupBy({ by: ["agentId"], where: { status: "COMPLETED", questionnaire: null }, _count: true }),
    prisma.commission.groupBy({ by: ["agentId", "status"], where: { createdAt: range, agentId: { not: null } }, _count: true, _sum: { amount: true } }),
    prisma.followUp.groupBy({ by: ["agentId"], where: { status: "PENDING", dueAt: { lt: now } }, _count: true }),
    prisma.fraudFlag.groupBy({ by: ["agentId", "severity"], where: { status: "OPEN", agentId: { not: null } }, _count: true }),
  ]);

  return agents.map((a) => {
    const l = leads.find((x) => x.createdById === a.id)?._count ?? 0;
    const c = calls.find((x) => x.agentId === a.id);
    const v = visits.find((x) => x.agentId === a.id);
    const com = commissions.filter((x) => x.agentId === a.id);
    const enrollments = com.filter((x) => ["APPROVED", "PAID", "PENDING_REVIEW"].includes(x.status)).reduce((s, x) => s + x._count, 0);
    const f = flags.filter((x) => x.agentId === a.id);
    return {
      id: a.id,
      name: a.name,
      active: a.active,
      leads: l,
      calls: c?._count ?? 0,
      avgQuality: c?._avg.qualityScore != null ? Math.round(c._avg.qualityScore) : null,
      visits: v?._count ?? 0,
      avgVisitMin: v?._avg.durationMin != null ? Math.round(v._avg.durationMin) : null,
      avgVerification: v?._avg.verificationScore != null ? Math.round(v._avg.verificationScore) : null,
      questionnairePending: qPending.find((x) => x.agentId === a.id)?._count ?? 0,
      enrollments,
      conversionRate: l ? Math.round((enrollments / l) * 100) : null,
      overdueFollowUps: overdue.find((x) => x.agentId === a.id)?._count ?? 0,
      openFlags: f.reduce((s, x) => s + x._count, 0),
      highFlags: f.filter((x) => x.severity === "HIGH").reduce((s, x) => s + x._count, 0),
      commissionApproved: com.filter((x) => x.status === "APPROVED" || x.status === "PAID").reduce((s, x) => s + (x._sum.amount ?? 0), 0),
      commissionPending: com.filter((x) => x.status === "PENDING_REVIEW" || x.status === "DISPUTED").reduce((s, x) => s + (x._sum.amount ?? 0), 0),
    };
  });
}

export function parseRange(sp: { from?: string; to?: string }) {
  const to = sp.to ? new Date(sp.to + "T23:59:59+05:30") : new Date();
  const from = sp.from ? new Date(sp.from + "T00:00:00+05:30") : new Date(to.getTime() - 30 * 864e5);
  return { from, to, fromStr: from.toISOString().slice(0, 10), toStr: to.toISOString().slice(0, 10) };
}
