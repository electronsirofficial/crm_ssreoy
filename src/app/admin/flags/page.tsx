import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FLAG_LABELS } from "@/lib/flags";
import { runSweepAction } from "@/app/actions/admin";
import { Card, Empty, PageHeader } from "@/components/ui";
import { FlagItem } from "@/components/FlagItem";

export default async function Flags({ searchParams }: { searchParams: Promise<{ status?: string; severity?: string; type?: string; agent?: string }> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const status = sp.status ?? "OPEN";
  const where: Prisma.FraudFlagWhereInput = {
    ...(status !== "ALL" ? { status: status as Prisma.EnumFlagStatusFilter["equals"] } : {}),
    ...(sp.severity ? { severity: sp.severity as Prisma.EnumFlagSeverityFilter["equals"] } : {}),
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.agent ? { agentId: sp.agent } : {}),
  };
  const [flags, agents, byType] = await Promise.all([
    prisma.fraudFlag.findMany({
      where,
      include: { agent: { select: { name: true } }, lead: { select: { studentName: true } }, reviewedBy: { select: { name: true } } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
    prisma.user.findMany({ where: { role: "AGENT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.fraudFlag.groupBy({ by: ["type"], where: { status: "OPEN" }, _count: true }),
  ]);
  return (
    <>
      <PageHeader
        title="Suspicious activity"
        subtitle="Signals for review — not proof of fraud. Confirm or dismiss each after checking the evidence."
        actions={
          <form action={runSweepAction}>
            <button className="btn-secondary">Run checks now</button>
          </form>
        }
      />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <select name="status" defaultValue={status} className="input w-auto">
          <option value="OPEN">Open</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="DISMISSED">Dismissed</option>
          <option value="ALL">All</option>
        </select>
        <select name="severity" defaultValue={sp.severity ?? ""} className="input w-auto">
          <option value="">Any severity</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select name="type" defaultValue={sp.type ?? ""} className="input w-auto">
          <option value="">All types</option>
          {Object.entries(FLAG_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v} {byType.find((b) => b.type === k) ? `(${byType.find((b) => b.type === k)!._count})` : ""}
            </option>
          ))}
        </select>
        <select name="agent" defaultValue={sp.agent ?? ""} className="input w-auto">
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card title={`${flags.length} flags`}>{flags.length ? flags.map((f) => <FlagItem key={f.id} f={f} showLead />) : <Empty>No flags match</Empty>}</Card>
    </>
  );
}
