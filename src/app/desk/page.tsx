import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findByPhone } from "@/lib/leads";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { Badge, Card, KV, PageHeader, fmtDate, humanize } from "@/components/ui";
import { WalkInForm, EnrollForm } from "./forms";

export default async function Desk({ searchParams }: { searchParams: Promise<{ phone?: string; lead?: string; new?: string; enrolled?: string }> }) {
  await requireUser(["RECEPTION", "ADMIN"]);
  const sp = await searchParams;
  const lead = sp.lead
    ? await prisma.lead.findUnique({ where: { id: sp.lead }, include: { enrollment: true } })
    : sp.phone
      ? await findByPhone(sp.phone).then((l) => (l ? prisma.lead.findUnique({ where: { id: l.id }, include: { enrollment: true } }) : null))
      : null;
  const [agents, today] = await Promise.all([
    prisma.user.findMany({ where: { role: "AGENT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.lead.findMany({
      where: { walkInAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      include: { enrollment: { select: { id: true } } },
      orderBy: { walkInAt: "desc" },
    }),
  ]);

  return (
    <>
      <PageHeader title="Front desk" subtitle="Record every family that visits the institute — even if an agent sent them." />

      <form className="card mb-4 flex gap-2 p-4">
        <input name="phone" defaultValue={sp.phone} placeholder="Family's mobile number" inputMode="numeric" className="input" required />
        <button className="btn-primary">Look up</button>
      </form>

      {sp.enrolled && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Enrollment recorded. Commission eligibility is being evaluated from the evidence.</div>}
      {sp.lead && sp.new === "1" && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">New walk-in registered.</div>}
      {sp.lead && sp.new === "0" && <div className="mb-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">This family was already in the CRM — their institute visit has been recorded.</div>}

      {lead ? (
        <Card title={lead.studentName} className="mb-4">
          <KV
            items={[
              ["Parent", lead.parentName],
              ["Phone", formatPhone(lead.phone)],
              ["Class / exam", `${lead.classLevel ?? "?"} · ${lead.targetExam}`],
              ["Visited institute", fmtDate(lead.walkInAt)],
              ["Status", <Badge key="s">{humanize(lead.stageKey)}</Badge>],
            ]}
          />
          <div className="mt-4 border-t border-slate-100 pt-4">
            {lead.enrollment ? (
              <p className="text-sm text-emerald-700">
                Enrolled in {lead.enrollment.course} on {fmtDate(lead.enrollment.enrolledAt)}
              </p>
            ) : lead.walkInAt ? (
              <EnrollForm leadId={lead.id} />
            ) : (
              <WalkInForm agents={agents} defaults={{ phone: lead.phone, studentName: lead.studentName, parentName: lead.parentName ?? "" }} existing />
            )}
          </div>
        </Card>
      ) : (
        <Card title={sp.phone ? `No record for ${normalizePhone(sp.phone)} — register walk-in` : "Register a walk-in"} className="mb-4">
          <WalkInForm agents={agents} defaults={{ phone: sp.phone ? normalizePhone(sp.phone) : "" }} />
        </Card>
      )}

      <Card title={`Today's visitors (${today.length})`}>
        {today.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {today.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <a href={`/desk?lead=${l.id}`} className="link">
                  {l.studentName}
                </a>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {fmtDate(l.walkInAt)}
                  {l.enrollment && <Badge tone="green">Enrolled</Badge>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No visitors recorded today.</p>
        )}
      </Card>
    </>
  );
}
