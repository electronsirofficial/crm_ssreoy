import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader, fmtDate } from "@/components/ui";
import { CheckOutPanel } from "./CheckOutPanel";

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["AGENT"]);
  const visit = await prisma.fieldVisit.findUnique({ where: { id: (await params).id }, include: { lead: true, questionnaire: { select: { id: true } } } });
  if (!visit || visit.agentId !== user.id) notFound();
  if (visit.status === "COMPLETED" && !visit.questionnaire) redirect(`/agent/visit/${visit.id}/questionnaire`);
  if (visit.status !== "IN_PROGRESS") redirect(`/agent/leads/${visit.leadId}`);
  return (
    <>
      <PageHeader title="Visit in progress" subtitle={visit.lead.studentName} />
      <div className="card space-y-3 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/files/${visit.photoPath}`} alt="Check-in" className="w-full rounded-lg" />
        <div className="text-sm text-slate-600">Checked in at {fmtDate(visit.checkInAt)}</div>
        <CheckOutPanel visitId={visit.id} checkInAt={visit.checkInAt.toISOString()} />
        <Link href={`/agent/leads/${visit.leadId}`} className="block text-center text-xs text-slate-500">
          View lead
        </Link>
      </div>
    </>
  );
}
