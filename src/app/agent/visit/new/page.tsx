import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { leadForUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { pendingQuestionnaires } from "@/lib/visits";
import { PageHeader } from "@/components/ui";
import { CheckInForm } from "./CheckInForm";

export default async function NewVisit({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const user = await requireUser(["AGENT"]);
  const lead = await leadForUser(user, (await searchParams).lead ?? "");
  if (!lead) notFound();
  const open = await prisma.fieldVisit.findFirst({ where: { agentId: user.id, status: "IN_PROGRESS" } });
  if (open) redirect(`/agent/visit/${open.id}`);
  const pending = await pendingQuestionnaires(user.id);
  if (pending.length) {
    return (
      <div className="card p-4 text-sm">
        Please submit the questionnaire for your visit to <b>{pending[0].lead.studentName}</b> before starting a new visit.{" "}
        <Link href={`/agent/visit/${pending[0].id}/questionnaire`} className="link">
          Fill it now
        </Link>
      </div>
    );
  }
  return (
    <>
      <PageHeader title="Check in at home visit" subtitle={`${lead.studentName}${lead.address ? ` · ${lead.address}` : ""}`} />
      <CheckInForm leadId={lead.id} />
    </>
  );
}
