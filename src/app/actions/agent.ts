"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Exam, FollowUpType, LeadSource, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createLeadAsAgent } from "@/lib/leads";
import { isValidPhone } from "@/lib/phone";
import { leadForUser } from "@/lib/access";
import { logActivity } from "@/lib/audit";
import { verifyVisit } from "@/lib/visits";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createLeadAction(_: unknown, form: FormData) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const phone = str(form, "phone");
  if (!str(form, "studentName")) return { error: "Student name is required" };
  if (!isValidPhone(phone)) return { error: "Enter a valid 10-digit Indian mobile number" };

  const res = await createLeadAsAgent(
    user,
    {
      studentName: str(form, "studentName"),
      parentName: str(form, "parentName"),
      phone,
      altPhone: str(form, "altPhone"),
      address: str(form, "address"),
      locality: str(form, "locality"),
      classLevel: str(form, "classLevel"),
      targetExam: (str(form, "targetExam") || "UNKNOWN") as Exam,
      school: str(form, "school"),
      notes: str(form, "notes"),
    },
    (str(form, "source") || "OUTBOUND_CALL") as LeadSource,
  );
  if (!res.created) {
    const mine = res.lead.assignedToId === user.id;
    return {
      error: mine
        ? "This family is already in your leads."
        : "This family is already registered in the CRM. It has not been added to your leads. If you believe you generated this lead, tell your manager.",
      existingId: mine ? res.lead.id : undefined,
    };
  }
  redirect(`/agent/leads/${res.lead.id}`);
}

export async function scheduleFollowUpAction(form: FormData) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const leadId = str(form, "leadId");
  const lead = await leadForUser(user, leadId);
  if (!lead) throw new Error("Lead not found");
  const dueAt = new Date(str(form, "dueAt"));
  if (isNaN(dueAt.getTime())) throw new Error("Invalid date");
  const agentId = lead.assignedToId ?? user.id;
  await prisma.followUp.create({
    data: { leadId, agentId, dueAt, type: (str(form, "type") || "CALL") as FollowUpType, notes: str(form, "notes") || null },
  });
  await refreshNextFollowUp(leadId);
  await logActivity({ leadId, actorId: user.id, type: "FOLLOW_UP_SCHEDULED", message: `Follow-up (${str(form, "type") || "CALL"}) scheduled for ${dueAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` });
  revalidatePath(`/agent/leads/${leadId}`);
  revalidatePath(`/admin/leads/${leadId}`);
  revalidatePath("/agent");
}

export async function completeFollowUpAction(form: FormData) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const fu = await prisma.followUp.findUnique({ where: { id: str(form, "id") } });
  if (!fu || (user.role !== "ADMIN" && fu.agentId !== user.id)) throw new Error("Not found");
  const status = str(form, "status") === "CANCELLED" ? "CANCELLED" : "DONE";
  await prisma.followUp.update({ where: { id: fu.id }, data: { status, completedAt: new Date(), outcome: str(form, "outcome") || null } });
  await refreshNextFollowUp(fu.leadId);
  await logActivity({ leadId: fu.leadId, actorId: user.id, type: "FOLLOW_UP_DONE", message: `Follow-up marked ${status.toLowerCase()}${str(form, "outcome") ? `: ${str(form, "outcome")}` : ""}` });
  revalidatePath("/agent");
  revalidatePath("/agent/followups");
  revalidatePath(`/agent/leads/${fu.leadId}`);
}

async function refreshNextFollowUp(leadId: string) {
  const next = await prisma.followUp.findFirst({ where: { leadId, status: "PENDING" }, orderBy: { dueAt: "asc" } });
  await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: next?.dueAt ?? null } });
}

export async function updateStageAction(form: FormData) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const leadId = str(form, "leadId");
  const lead = await leadForUser(user, leadId);
  if (!lead) throw new Error("Lead not found");
  const stageKey = str(form, "stageKey");
  // Enrollment and office visits are recorded by the front desk, not self-reported by agents.
  if (user.role !== "ADMIN" && ["ENROLLED", "OFFICE_VISIT_DONE"].includes(stageKey)) throw new Error("Only the front desk can record this stage");
  const stage = await prisma.leadStage.findUnique({ where: { key: stageKey } });
  if (!stage) throw new Error("Unknown stage");
  await prisma.lead.update({ where: { id: leadId }, data: { stageKey, lostReason: stageKey === "LOST" ? str(form, "lostReason") || null : null } });
  await logActivity({ leadId, actorId: user.id, type: "STAGE_CHANGED", message: `Stage: ${lead.stageKey} → ${stageKey}` });
  revalidatePath(`/agent/leads/${leadId}`);
  revalidatePath(`/admin/leads/${leadId}`);
}

export async function submitQuestionnaireAction(_: unknown, form: FormData) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const visitId = str(form, "visitId");
  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId }, include: { questionnaire: true } });
  if (!visit || visit.agentId !== user.id) return { error: "Visit not found" };
  if (visit.status !== "COMPLETED") return { error: "Check out of the visit before filling the questionnaire" };
  if (visit.questionnaire) return { error: "Questionnaire already submitted" };

  const questions = await prisma.questionnaireQuestion.findMany({ where: { active: true }, orderBy: { order: "asc" } });
  const answers: Record<string, Prisma.InputJsonValue> = {};
  const missing: string[] = [];
  for (const q of questions) {
    let v: Prisma.InputJsonValue | null = null;
    if (q.type === "MULTI") {
      const all = form.getAll(q.key).map(String).filter(Boolean);
      v = all.length ? all : null;
    } else if (q.type === "BOOLEAN") {
      const raw = str(form, q.key);
      v = raw ? raw === "yes" : null;
    } else if (q.type === "NUMBER") {
      const raw = str(form, q.key);
      v = raw ? Number(raw) : null;
    } else {
      v = str(form, q.key) || null;
    }
    if (v === null) {
      if (q.required) missing.push(q.text);
    } else answers[q.key] = v;
  }
  if (missing.length) return { error: `Please answer: ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ""}` };

  const startedAt = new Date(Number(str(form, "startedAt")) || Date.now());
  const now = new Date();
  // Never trust the client's start time beyond the moment the form could first have been opened.
  const earliest = visit.checkOutAt ?? visit.checkInAt;
  const effectiveStart = startedAt < earliest ? earliest : startedAt > now ? now : startedAt;
  const required = questions.filter((q) => q.required).length;
  const answeredRequired = questions.filter((q) => q.required && answers[q.key] !== undefined).length;

  await prisma.questionnaireResponse.create({
    data: {
      visitId,
      answers,
      startedAt: effectiveStart,
      fillSeconds: Math.round((now.getTime() - effectiveStart.getTime()) / 1000),
      completeness: required ? Math.round((answeredRequired / required) * 100) : 100,
    },
  });

  // Turn the agent's follow-up answer into an actual scheduled task.
  const fuDate = typeof answers.followup_date === "string" ? new Date(answers.followup_date + "T10:00:00+05:30") : null;
  const action = answers.followup_action;
  if (fuDate && !isNaN(fuDate.getTime()) && action !== "No further action") {
    const type: FollowUpType = action === "Second home visit" ? "HOME_VISIT" : String(action ?? "").includes("institute") || String(action ?? "").includes("demo") ? "INSTITUTE_VISIT" : "CALL";
    await prisma.followUp.create({ data: { leadId: visit.leadId, agentId: user.id, dueAt: fuDate, type, notes: String(action ?? "") } });
    await refreshNextFollowUp(visit.leadId);
  }
  // Fill blanks on the lead from structured answers.
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: visit.leadId } });
  const examMap: Record<string, Exam> = { "IIT-JEE": "JEE", NEET: "NEET", "Foundation / Olympiad": "FOUNDATION", Other: "OTHER" };
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      classLevel: lead.classLevel ?? (typeof answers.current_class === "string" ? answers.current_class : undefined),
      targetExam: lead.targetExam === "UNKNOWN" && typeof answers.target_exam === "string" ? examMap[answers.target_exam] ?? undefined : undefined,
      stageKey: answers.interest_level === "Not interested" ? "FOLLOW_UP_REQUIRED" : undefined,
    },
  });

  await logActivity({ leadId: visit.leadId, actorId: user.id, type: "QUESTIONNAIRE", message: "Post-visit questionnaire submitted", data: { visitId } });
  await verifyVisit(visitId);
  redirect(`/agent/leads/${visit.leadId}?done=visit`);
}
