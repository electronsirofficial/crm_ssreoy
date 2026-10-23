import type { Exam, LeadSource, User } from "@prisma/client";
import { prisma } from "./db";
import { normalizePhone } from "./phone";
import { raiseFlag } from "./flags";
import { logActivity } from "./audit";

export type LeadInput = {
  studentName: string;
  parentName?: string;
  phone: string;
  altPhone?: string;
  email?: string;
  address?: string;
  locality?: string;
  classLevel?: string;
  targetExam?: Exam;
  school?: string;
  notes?: string;
};

export async function findByPhone(raw: string) {
  const phone = normalizePhone(raw);
  if (!phone) return null;
  return prisma.lead.findFirst({
    where: { OR: [{ phone }, { altPhone: phone }] },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
}

/**
 * An agent registers a prospect. Phone numbers are unique across the institute: if the family already
 * exists the agent is NOT given the lead — the attempt is logged as a claim and flagged when it
 * conflicts with another agent or with a walk-in. Ownership is never granted by data entry alone.
 */
export async function createLeadAsAgent(agent: User, input: LeadInput, source: LeadSource) {
  const phone = normalizePhone(input.phone);
  const existing = (await findByPhone(phone)) ?? (input.altPhone ? await findByPhone(input.altPhone) : null);

  if (existing) {
    await prisma.leadClaim.create({ data: { leadId: existing.id, agentId: agent.id, kind: "DUPLICATE_ATTEMPT" } });
    await logActivity({
      leadId: existing.id,
      actorId: agent.id,
      type: "DUPLICATE_ATTEMPT",
      message: `${agent.name} tried to register this family again (phone ${phone})`,
    });
    if (existing.walkInAt) {
      await raiseFlag({
        type: "CLAIM_ON_WALK_IN",
        severity: "HIGH",
        message: `${agent.name} tried to register ${existing.studentName} after the family walked in on ${existing.walkInAt.toLocaleDateString("en-IN")}`,
        agentId: agent.id,
        leadId: existing.id,
        dedupeKey: `CLAIM_ON_WALK_IN:${existing.id}:${agent.id}`,
      });
    } else if (existing.assignedToId && existing.assignedToId !== agent.id) {
      await raiseFlag({
        type: "DUPLICATE_CLAIM",
        severity: "MEDIUM",
        message: `${agent.name} tried to register ${existing.studentName}, already assigned to ${existing.assignedTo?.name}`,
        agentId: agent.id,
        leadId: existing.id,
        dedupeKey: `DUPLICATE_CLAIM:${existing.id}:${agent.id}`,
      });
    }
    return { created: false as const, lead: existing };
  }

  const lead = await prisma.lead.create({
    data: {
      ...clean(input),
      phone,
      altPhone: input.altPhone ? normalizePhone(input.altPhone) : null,
      source,
      stageKey: "NEW",
      createdById: agent.id,
      assignedToId: agent.id,
      claims: { create: { agentId: agent.id, kind: "CREATED" } },
    },
  });
  await logActivity({ leadId: lead.id, actorId: agent.id, type: "LEAD_CREATED", message: `Lead created by ${agent.name} (${source})` });
  return { created: true as const, lead };
}

/**
 * Reception records a family at the front desk. If the family is new, it becomes a WALK_IN lead with no
 * agent. If it already exists, the walk-in time is stamped — any agent evidence must pre-date it.
 */
export async function registerWalkIn(receptionist: User, input: LeadInput & { declaredAgentId?: string; walkInNotes?: string }) {
  const phone = normalizePhone(input.phone);
  const now = new Date();
  const existing = await findByPhone(phone);

  if (existing) {
    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        walkInAt: existing.walkInAt ?? now,
        walkInDeclaredAgentId: input.declaredAgentId || existing.walkInDeclaredAgentId,
        walkInNotes: input.walkInNotes || existing.walkInNotes,
        stageKey: existing.stageKey === "ENROLLED" ? existing.stageKey : "OFFICE_VISIT_DONE",
      },
    });
    await logActivity({
      leadId: lead.id,
      actorId: receptionist.id,
      type: "OFFICE_VISIT",
      message: `Family visited the institute (recorded by ${receptionist.name}); existing lead from ${existing.source}`,
      data: { declaredAgentId: input.declaredAgentId ?? null },
    });
    return { created: false as const, lead };
  }

  const lead = await prisma.lead.create({
    data: {
      ...clean(input),
      phone,
      altPhone: input.altPhone ? normalizePhone(input.altPhone) : null,
      source: "WALK_IN",
      stageKey: "OFFICE_VISIT_DONE",
      createdById: receptionist.id,
      walkInAt: now,
      walkInDeclaredAgentId: input.declaredAgentId || null,
      walkInNotes: input.walkInNotes || null,
    },
  });
  await logActivity({
    leadId: lead.id,
    actorId: receptionist.id,
    type: "WALK_IN",
    message: `Direct walk-in registered by ${receptionist.name} — no prior record of this family`,
    data: { declaredAgentId: input.declaredAgentId ?? null },
  });
  return { created: true as const, lead };
}

function clean(i: LeadInput) {
  const s = (v?: string) => (v && v.trim() ? v.trim() : null);
  return {
    studentName: i.studentName.trim(),
    parentName: s(i.parentName),
    email: s(i.email),
    address: s(i.address),
    locality: s(i.locality),
    classLevel: s(i.classLevel),
    targetExam: i.targetExam ?? "UNKNOWN",
    school: s(i.school),
    notes: s(i.notes),
  };
}
