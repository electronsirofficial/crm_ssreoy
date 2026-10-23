import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { Badge, Card, PageHeader, fmtDate, humanize } from "@/components/ui";

export default async function Audit({ searchParams }: { searchParams: Promise<{ verify?: string }> }) {
  await requireUser(["ADMIN"]);
  const { verify } = await searchParams;
  const result = verify ? await verifyAuditChain() : null;
  const rows = await prisma.activity.findMany({ include: { actor: { select: { name: true } }, lead: { select: { studentName: true } } }, orderBy: { seq: "desc" }, take: 200 });
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only and hash-chained: every entry includes the hash of the previous one, so edits or deletions are detectable."
        actions={
          <Link href="/admin/audit?verify=1" className="btn-secondary">
            Verify integrity
          </Link>
        }
      />
      {result && (
        <div className={`mb-4 rounded-lg p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {result.ok ? `All ${result.count} entries verified — no tampering detected.` : `Chain broken at entry #${result.brokenAtSeq} — records may have been altered.`}
        </div>
      )}
      <Card>
        <div className="-mx-4 -my-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Who</th>
                <th>Type</th>
                <th>Lead</th>
                <th>What</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs text-slate-400 tabular-nums">{r.seq}</td>
                  <td className="text-xs whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  <td className="text-sm">{r.actor?.name ?? "system"}</td>
                  <td>
                    <Badge>{humanize(r.type)}</Badge>
                  </td>
                  <td className="text-sm">
                    {r.leadId && (
                      <Link href={`/admin/leads/${r.leadId}`} className="link">
                        {r.lead?.studentName}
                      </Link>
                    )}
                  </td>
                  <td className="text-sm">{r.message}</td>
                  <td className="font-mono text-[10px] text-slate-400">{r.hash.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
