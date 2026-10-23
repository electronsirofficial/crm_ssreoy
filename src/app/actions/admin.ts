"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { Prisma, type QuestionType, type Role } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit";
import { applyAttribution } from "@/lib/attribution";
import { getSettings, saveSettings, type CrmSettings } from "@/lib/settings";
import { runSweep } from "@/lib/intelligence";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, fallback: number) => {
  const n = Number(f.get(k));
  return Number.isFinite(n) && String(f.get(k) ?? "") !== "" ? n : fallback;
};

export async function reassignLeadAction(form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const leadId = str(form, "leadId");
  const agentId = str(form, "agentId") || null;
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { assignedTo: true } });
  const to = agentId ? await prisma.user.findUnique({ where: { id: agentId } }) : null;
  await prisma.lead.update({ where: { id: leadId }, data: { assignedToId: agentId } });
  await prisma.followUp.updateMany({ where: { leadId, status: "PENDING" }, data: { agentId: agentId ?? undefined } });
  await logActivity({
    leadId,
    actorId: admin.id,
    type: "REASSIGNED",
    message: `Reassigned from ${lead.assignedTo?.name ?? "nobody"} to ${to?.name ?? "nobody"} by ${admin.name}. Reassignment does not transfer earlier evidence.`,
  });
  revalidatePath(`/admin/leads/${leadId}`);
}

export async function recomputeAttributionAction(form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const leadId = str(form, "leadId");
  await applyAttribution(leadId, admin);
  revalidatePath(`/admin/leads/${leadId}`);
  revalidatePath("/admin/commissions");
}

export async function decideCommissionAction(_: unknown, form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const id = str(form, "commissionId");
  const decision = str(form, "decision") as "APPROVED" | "REJECTED" | "PAID";
  if (!["APPROVED", "REJECTED", "PAID"].includes(decision)) return { error: "Invalid decision" };
  const c = await prisma.commission.findUniqueOrThrow({ where: { id } });
  const agentId = str(form, "agentId") || c.agentId;
  const note = str(form, "note");
  if (decision === "PAID" && c.status !== "APPROVED") return { error: "Only approved commissions can be marked paid" };
  if (decision === "APPROVED" && !agentId) return { error: "Choose the agent who earned this commission" };
  const overriding = decision === "APPROVED" ? c.status === "DISPUTED" || c.status === "NOT_ELIGIBLE" || agentId !== c.agentId : decision === "REJECTED" && c.status === "PENDING_REVIEW";
  if (overriding && !note) return { error: "Add a note explaining why you are overriding the system's recommendation" };
  const amount = num(form, "amount", c.amount);
  const agent = agentId ? await prisma.user.findUnique({ where: { id: agentId } }) : null;
  await prisma.commission.update({
    where: { id },
    data: {
      status: decision,
      agentId: decision === "REJECTED" ? c.agentId : agentId,
      amount: decision === "APPROVED" ? amount : c.amount,
      decidedById: admin.id,
      decidedAt: new Date(),
      decisionNote: note || c.decisionNote,
    },
  });
  await logActivity({
    leadId: c.leadId,
    actorId: admin.id,
    type: "COMMISSION_DECISION",
    message: `Commission ${decision.toLowerCase()} by ${admin.name}${agent ? ` for ${agent.name}` : ""}${decision === "APPROVED" ? ` — ₹${amount}` : ""}${note ? ` · ${note}` : ""}`,
    data: { commissionId: id, previousStatus: c.status, systemAgentId: c.agentId, agentId: agentId ?? null, amount },
  });
  revalidatePath("/admin/commissions");
  revalidatePath(`/admin/leads/${c.leadId}`);
  return { ok: `Marked ${decision.toLowerCase()}` };
}

export async function reviewFlagAction(form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const id = str(form, "flagId");
  const status = str(form, "status") as "DISMISSED" | "CONFIRMED" | "OPEN";
  const flag = await prisma.fraudFlag.update({
    where: { id },
    data: { status, reviewedById: admin.id, reviewedAt: new Date(), reviewNote: str(form, "note") || null },
  });
  await logActivity({ leadId: flag.leadId, actorId: admin.id, type: "FLAG_REVIEWED", message: `Flag "${flag.type}" marked ${status.toLowerCase()} by ${admin.name}` });
  revalidatePath("/admin/flags");
  if (flag.leadId) revalidatePath(`/admin/leads/${flag.leadId}`);
}

export async function createUserAction(_: unknown, form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!str(form, "name") || !email) return { error: "Name and email are required" };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  if (await prisma.user.findUnique({ where: { email } })) return { error: "A user with this email exists" };
  const user = await prisma.user.create({
    data: { name: str(form, "name"), email, phone: str(form, "phone") || null, role: (str(form, "role") || "AGENT") as Role, passwordHash: await bcrypt.hash(password, 10) },
  });
  await logActivity({ actorId: admin.id, type: "USER_CREATED", message: `${admin.name} created ${user.role.toLowerCase()} ${user.name}` });
  revalidatePath("/admin/agents");
  return { ok: `Created ${user.name}` };
}

export async function toggleUserAction(form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: str(form, "userId") } });
  if (user.id === admin.id) throw new Error("You cannot deactivate yourself");
  await prisma.user.update({ where: { id: user.id }, data: { active: !user.active } });
  await logActivity({ actorId: admin.id, type: "USER_UPDATED", message: `${user.name} ${user.active ? "deactivated" : "activated"} by ${admin.name}` });
  revalidatePath("/admin/agents");
}

export async function resetPasswordAction(form: FormData) {
  await requireUser(["ADMIN"]);
  const password = str(form, "password");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  await prisma.user.update({ where: { id: str(form, "userId") }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  revalidatePath("/admin/agents");
}

export async function saveSettingsAction(_: unknown, form: FormData) {
  const admin = await requireUser(["ADMIN"]);
  const s = await getSettings();
  const next: CrmSettings = {
    commission: {
      amountPerEnrollment: num(form, "commission.amountPerEnrollment", s.commission.amountPerEnrollment),
      attributionWindowDays: num(form, "commission.attributionWindowDays", s.commission.attributionWindowDays),
      model: str(form, "commission.model") === "LAST_QUALIFYING" ? "LAST_QUALIFYING" : "FIRST_QUALIFYING",
      requireAdminApproval: form.get("commission.requireAdminApproval") === "on",
    },
    call: {
      minDurationSec: num(form, "call.minDurationSec", s.call.minDurationSec),
      minQualityScore: num(form, "call.minQualityScore", s.call.minQualityScore),
      requireRecording: form.get("call.requireRecording") === "on",
      lateUploadGraceHours: num(form, "call.lateUploadGraceHours", s.call.lateUploadGraceHours),
    },
    visit: Object.fromEntries(Object.entries(s.visit).map(([k, v]) => [k, num(form, `visit.${k}`, v)])) as CrmSettings["visit"],
    ai: { hotLeadThreshold: num(form, "ai.hotLeadThreshold", s.ai.hotLeadThreshold), neglectHours: num(form, "ai.neglectHours", s.ai.neglectHours) },
  };
  await saveSettings(next);
  await logActivity({ actorId: admin.id, type: "SETTINGS_CHANGED", message: `${admin.name} updated CRM rules`, data: next as unknown as Prisma.InputJsonValue });
  revalidatePath("/admin/settings");
  return { ok: "Saved" };
}

export async function upsertCriterionAction(form: FormData) {
  await requireUser(["ADMIN"]);
  const id = str(form, "id");
  const data = {
    label: str(form, "label"),
    description: str(form, "description"),
    weight: num(form, "weight", 10),
    order: num(form, "order", 0),
    active: form.get("active") === "on",
  };
  if (!data.label || !data.description) throw new Error("Label and description are required");
  if (id) await prisma.evaluationCriterion.update({ where: { id }, data });
  else await prisma.evaluationCriterion.create({ data: { ...data, key: slug(data.label) } });
  revalidatePath("/admin/settings");
}

export async function upsertQuestionAction(form: FormData) {
  await requireUser(["ADMIN"]);
  const id = str(form, "id");
  const options = str(form, "options")
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
  const data = {
    text: str(form, "text"),
    type: (str(form, "type") || "SINGLE") as QuestionType,
    options: options.length ? options : Prisma.JsonNull,
    required: form.get("required") === "on",
    order: num(form, "order", 0),
    active: form.get("active") === "on",
  };
  if (!data.text) throw new Error("Question text is required");
  if (id) await prisma.questionnaireQuestion.update({ where: { id }, data });
  else await prisma.questionnaireQuestion.create({ data: { ...data, key: slug(data.text).slice(0, 40) + "_" + Date.now().toString(36) } });
  revalidatePath("/admin/settings");
}

export async function upsertStageAction(form: FormData) {
  await requireUser(["ADMIN"]);
  const key = str(form, "key").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!key || !str(form, "label")) throw new Error("Key and label are required");
  await prisma.leadStage.upsert({
    where: { key },
    create: { key, label: str(form, "label"), order: num(form, "order", 99), color: str(form, "color") || "slate" },
    update: {
      label: str(form, "label"),
      order: num(form, "order", 99),
      color: str(form, "color") || "slate",
      // System stages drive walk-in/enrollment logic and must stay active.
      active: ["NEW", "OFFICE_VISIT_DONE", "ENROLLED"].includes(key) || form.get("active") === "on",
    },
  });
  revalidatePath("/admin/settings");
}

export async function runSweepAction() {
  await requireUser(["ADMIN"]);
  await runSweep();
  revalidatePath("/admin");
  revalidatePath("/admin/flags");
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
