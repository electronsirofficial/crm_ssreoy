import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { QuestionnaireForm } from "./QuestionnaireForm";

export default async function QuestionnairePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["AGENT"]);
  const visit = await prisma.fieldVisit.findUnique({ where: { id: (await params).id }, include: { lead: true, questionnaire: { select: { id: true } } } });
  if (!visit || visit.agentId !== user.id) notFound();
  if (visit.status === "IN_PROGRESS") redirect(`/agent/visit/${visit.id}`);
  if (visit.questionnaire) redirect(`/agent/leads/${visit.leadId}`);
  const questions = await prisma.questionnaireQuestion.findMany({ where: { active: true }, orderBy: { order: "asc" } });
  return (
    <>
      <PageHeader title="Post-visit questionnaire" subtitle={`${visit.lead.studentName} · ${visit.durationMin ?? "?"} min visit`} />
      <QuestionnaireForm
        visitId={visit.id}
        questions={questions.map((q) => ({ key: q.key, text: q.text, type: q.type, options: (q.options as string[] | null) ?? [], required: q.required }))}
      />
    </>
  );
}
