import { Prisma, type CommissionStatus, type User } from "@prisma/client";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { visitQualifies } from "./visits";
import { raiseFlag } from "./flags";
import { logActivity } from "./audit";

export type Touchpoint = {
  kind: "CALL" | "VISIT";
  id: string;
  agentId: string;
  agentName: string;
  at: string; // when it happened (server time for visits; reported call time for calls)
  recordedAt: string; // server time the evidence reached the CRM
  qualifies: boolean;
  contested: boolean; // plausible but needs a human (e.g. uploaded after the walk-in)
  strength: number; // 0..1
  summary: string;
  reasons: string[]; // why it does / doesn't qualify
};

export type AttributionResult = {
  status: CommissionStatus;
  attribution: "AGENT_CALL" | "AGENT_VISIT" | "AGENT_CALL_AND_VISIT" | "WALK_IN" | "CONTESTED" | "NO_EVIDENCE";
  agentId: string | null;
  amount: number;
  confidence: number;
  reasoning: string[];
  touchpoints: Touchpoint[];
  contenders: { agentId: string; name: string; strength: number; firstEvidenceAt: string; lastEvidenceAt: string }[];
};

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

/**
 * Decides who (if anyone) earned the admission, from evidence only:
 *  - the cutoff is the first moment the family was physically at the institute (walk-in or enrollment);
 *    agent work after that point cannot have caused the visit,
 *  - calls need a recording that AI judged a meaningful conversation of adequate quality,
 *  - visits need a GPS/photo-verified, long-enough visit with a submitted questionnaire,
 *  - evidence uploaded after the cutoff for an event claimed before it is "contested" and goes to an admin.
 * Creating the lead or typing a phone number earns nothing by itself.
 */
export async function computeAttribution(leadId: string): Promise<AttributionResult> {
  const s = await getSettings();
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      enrollment: true,
      calls: { include: { agent: true } },
      visits: { include: { agent: true, questionnaire: true } },
      flags: { where: { status: { not: "DISMISSED" } } },
    },
  });

  const enrolledAt = lead.enrollment?.enrolledAt ?? new Date();
  const cutoff = lead.walkInAt && lead.walkInAt < enrolledAt ? lead.walkInAt : enrolledAt;
  const windowStart = new Date(enrolledAt.getTime() - s.commission.attributionWindowDays * 864e5);
  const blocking = (field: "callId" | "visitId", id: string) =>
    lead.flags.filter((f) => f[field] === id && f.severity === "HIGH" && f.status !== "DISMISSED");

  const touchpoints: Touchpoint[] = [];

  for (const c of lead.calls) {
    const reasons: string[] = [];
    let ok = true;
    let contested = false;
    const fail = (why: string) => {
      ok = false;
      reasons.push(why);
    };
    const ai = (c.aiInsights ?? {}) as { meaningfulConversation?: boolean; invitedToVisit?: boolean };
    // An agent-typed transcript is not independent evidence; only an actual recording is.
    if (s.call.requireRecording && !c.recordingPath) fail("No call recording (typed transcripts are not evidence)");
    if (c.analysisStatus !== "DONE") fail("Not analysed by AI yet");
    if ((c.durationSec ?? 0) < s.call.minDurationSec) fail(`Shorter than ${s.call.minDurationSec}s`);
    if (c.qualityScore != null && c.qualityScore < s.call.minQualityScore) fail(`Quality ${c.qualityScore} below ${s.call.minQualityScore}`);
    if (c.analysisStatus === "DONE" && ai.meaningfulConversation === false) fail("AI found no meaningful conversation");
    if (c.calledAt >= cutoff) fail(`Happened after the family's institute visit (${fmt(cutoff)})`);
    else if (c.createdAt > cutoff) {
      contested = true;
      reasons.push(`Claimed for ${fmt(c.calledAt)} but recording uploaded ${fmt(c.createdAt)}, after the family walked in`);
    }
    if (c.calledAt < windowStart) fail(`Older than the ${s.commission.attributionWindowDays}-day window`);
    const hf = blocking("callId", c.id);
    if (hf.length) fail(`Open high-severity flag: ${hf[0].message}`);
    if (ok && !contested) reasons.push(`Recorded call, quality ${c.qualityScore}${ai.invitedToVisit ? ", invited family to visit" : ""}`);
    touchpoints.push({
      kind: "CALL",
      id: c.id,
      agentId: c.agentId,
      agentName: c.agent.name,
      at: c.calledAt.toISOString(),
      recordedAt: c.createdAt.toISOString(),
      qualifies: ok && !contested,
      contested: ok && contested,
      strength: ok ? Math.min(1, (c.qualityScore ?? 0) / 100 + (ai.invitedToVisit ? 0.15 : 0)) : 0,
      summary: c.summary ?? "Call",
      reasons,
    });
  }

  for (const v of lead.visits) {
    const reasons: string[] = [];
    let ok = visitQualifies(v, s);
    const fail = (why: string) => {
      ok = false;
      reasons.push(why);
    };
    if (!ok) {
      if (v.status !== "COMPLETED") reasons.push("Visit not completed");
      if ((v.durationMin ?? 0) < s.visit.minDurationMin) reasons.push(`Lasted ${v.durationMin ?? 0} min (min ${s.visit.minDurationMin})`);
      if ((v.verificationScore ?? 0) < s.visit.minVerificationScore) reasons.push(`Verification score ${v.verificationScore ?? "—"} below ${s.visit.minVerificationScore}`);
      if (!v.questionnaire) reasons.push("Questionnaire not submitted");
    }
    const interest = (v.questionnaire?.answers as Record<string, unknown> | undefined)?.interest_level;
    // The agent's own report that the family wasn't interested means the visit didn't generate the admission.
    if (interest === "Not interested") fail("Agent recorded the family as not interested");
    if (v.checkInAt >= cutoff) fail(`Happened after the family's institute visit (${fmt(cutoff)})`);
    if (v.checkInAt < windowStart) fail(`Older than the ${s.commission.attributionWindowDays}-day window`);
    const hf = blocking("visitId", v.id);
    if (hf.length) fail(`Open high-severity flag: ${hf[0].message}`);
    if (ok) reasons.push(`Verified visit (${v.verificationScore}/100, ${v.durationMin} min)${interest ? `, interest: ${interest}` : ""}`);
    touchpoints.push({
      kind: "VISIT",
      id: v.id,
      agentId: v.agentId,
      agentName: v.agent.name,
      at: v.checkInAt.toISOString(),
      recordedAt: v.checkInAt.toISOString(),
      qualifies: ok,
      contested: false,
      strength: ok ? Math.min(1, 0.5 + (v.verificationScore ?? 0) / 200) : 0,
      summary: `Home visit, ${v.durationMin ?? "?"} min`,
      reasons,
    });
  }
  touchpoints.sort((a, b) => a.at.localeCompare(b.at));

  // Group qualifying evidence by agent.
  const byAgent = new Map<string, { name: string; tps: Touchpoint[] }>();
  for (const t of touchpoints.filter((t) => t.qualifies)) {
    const e = byAgent.get(t.agentId) ?? { name: t.agentName, tps: [] };
    e.tps.push(t);
    byAgent.set(t.agentId, e);
  }
  const contenders = [...byAgent.entries()].map(([agentId, e]) => ({
    agentId,
    name: e.name,
    strength: Math.round(Math.min(1, e.tps.reduce((a, t) => a + t.strength, 0)) * 100),
    firstEvidenceAt: e.tps[0].at,
    lastEvidenceAt: e.tps[e.tps.length - 1].at,
  }));
  const contested = touchpoints.filter((t) => t.contested);
  const reasoning: string[] = [];

  reasoning.push(
    lead.walkInAt
      ? `Family first came to the institute on ${fmt(lead.walkInAt)}${lead.source === "WALK_IN" ? " as a direct walk-in (no prior record)" : ""}.`
      : `Family enrolled on ${fmt(enrolledAt)}.`,
  );
  if (lead.walkInDeclaredAgentId) {
    const declared = await prisma.user.findUnique({ where: { id: lead.walkInDeclaredAgentId }, select: { name: true } });
    reasoning.push(`At the desk the family mentioned ${declared?.name ?? "an agent"} (unverified, informational only).`);
  }

  const base = { touchpoints, contenders };

  if (contenders.length === 0) {
    const attribution = lead.source === "WALK_IN" ? "WALK_IN" : "NO_EVIDENCE";
    const nonQual = touchpoints.filter((t) => !t.qualifies && !t.contested);
    if (attribution === "WALK_IN") reasoning.push("No agent had a verified interaction before the family walked in — no commission.");
    else reasoning.push("No agent interaction meets the evidence rules — no commission.");
    if (nonQual.length) reasoning.push(`${nonQual.length} agent interaction(s) were recorded but did not qualify (see evidence).`);
    if (contested.length) {
      reasoning.push(`${contested.length} interaction(s) are contested and need an admin decision.`);
      return { ...base, status: "DISPUTED", attribution: "CONTESTED", agentId: contested[0].agentId, amount: s.commission.amountPerEnrollment, confidence: 30, reasoning };
    }
    return { ...base, status: "NOT_ELIGIBLE", attribution, agentId: null, amount: 0, confidence: 90, reasoning };
  }

  const pick =
    s.commission.model === "FIRST_QUALIFYING"
      ? [...contenders].sort((a, b) => a.firstEvidenceAt.localeCompare(b.firstEvidenceAt))[0]
      : [...contenders].sort((a, b) => b.lastEvidenceAt.localeCompare(a.lastEvidenceAt))[0];
  const tps = byAgent.get(pick.agentId)!.tps;
  const hasCall = tps.some((t) => t.kind === "CALL");
  const hasVisit = tps.some((t) => t.kind === "VISIT");
  const attribution = hasCall && hasVisit ? "AGENT_CALL_AND_VISIT" : hasVisit ? "AGENT_VISIT" : "AGENT_CALL";

  if (contenders.length > 1 || contested.some((t) => t.agentId !== pick.agentId)) {
    reasoning.push(
      `Multiple agents have qualifying evidence: ${contenders.map((c) => `${c.name} (strength ${c.strength})`).join(", ")}.`,
      `Policy "${s.commission.model === "FIRST_QUALIFYING" ? "first qualifying interaction" : "last qualifying interaction"}" suggests ${pick.name}; admin must decide.`,
    );
    return { ...base, status: "DISPUTED", attribution: "CONTESTED", agentId: pick.agentId, amount: s.commission.amountPerEnrollment, confidence: 40, reasoning };
  }

  let confidence = 55 + Math.round(pick.strength * 0.3);
  if (hasCall && hasVisit) confidence += 10;
  if (lead.walkInDeclaredAgentId === pick.agentId) confidence += 5;
  const openAgentFlags = lead.flags.filter((f) => f.agentId === pick.agentId && f.status === "OPEN" && f.severity !== "LOW");
  if (openAgentFlags.length) {
    confidence -= 15;
    reasoning.push(`${openAgentFlags.length} open flag(s) on this agent for this lead should be reviewed.`);
  }
  confidence = Math.max(0, Math.min(100, confidence));
  reasoning.push(
    `${pick.name} had ${tps.length} qualifying interaction(s) before the family came in, first on ${fmt(new Date(pick.firstEvidenceAt))}.`,
  );
  const auto = !s.commission.requireAdminApproval && !openAgentFlags.length;
  reasoning.push(auto ? "Auto-approved by policy." : "Eligible — awaiting admin approval.");
  return { ...base, status: auto ? "APPROVED" : "PENDING_REVIEW", attribution, agentId: pick.agentId, amount: s.commission.amountPerEnrollment, confidence, reasoning };
}

/** Computes and stores the commission decision. Final decisions (approved/rejected/paid) are never overwritten. */
export async function applyAttribution(leadId: string, actor?: User | null) {
  const r = await computeAttribution(leadId);
  const existing = await prisma.commission.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
  if (existing && ["APPROVED", "REJECTED", "PAID"].includes(existing.status) && existing.decidedById) return existing;

  const data = {
    agentId: r.agentId,
    status: r.status,
    attribution: r.attribution,
    amount: r.amount,
    confidence: r.confidence,
    reasoning: r.reasoning as Prisma.InputJsonValue,
    evidence: r.touchpoints as unknown as Prisma.InputJsonValue,
    contenders: r.contenders as unknown as Prisma.InputJsonValue,
  };
  const commission = existing
    ? await prisma.commission.update({ where: { id: existing.id }, data })
    : await prisma.commission.create({ data: { ...data, leadId } });

  if (r.status === "DISPUTED" && r.contenders.length > 1) {
    await raiseFlag({
      type: "MULTI_AGENT_ATTRIBUTION",
      severity: "MEDIUM",
      message: `${r.contenders.map((c) => c.name).join(" and ")} both have qualifying evidence for this admission`,
      leadId,
      details: r.contenders as unknown as Prisma.InputJsonValue,
      dedupeKey: `MULTI_AGENT_ATTRIBUTION:${leadId}`,
    });
  }
  await logActivity({
    leadId,
    actorId: actor?.id ?? null,
    type: "ATTRIBUTION",
    message: `Attribution computed: ${r.attribution} → ${r.status}${r.agentId ? ` (${r.contenders.find((c) => c.agentId === r.agentId)?.name ?? "agent"})` : ""}`,
    data: { commissionId: commission.id, status: r.status, attribution: r.attribution, confidence: r.confidence },
  });
  return commission;
}

export async function recordEnrollment(actor: User, leadId: string, course: string, feeAmount: number | null) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { enrollment: true } });
  if (lead.enrollment) throw new Error("This student is already enrolled");
  const now = new Date();
  await prisma.enrollment.create({ data: { leadId, course, feeAmount, recordedById: actor.id, enrolledAt: now } });
  // Enrolling requires being at the institute, so this is the latest possible "family arrived" time.
  await prisma.lead.update({ where: { id: leadId }, data: { stageKey: "ENROLLED", walkInAt: lead.walkInAt ?? now } });
  await prisma.followUp.updateMany({ where: { leadId, status: "PENDING" }, data: { status: "CANCELLED", outcome: "Enrolled" } });
  await logActivity({ leadId, actorId: actor.id, type: "ENROLLED", message: `Enrolled in ${course} (recorded by ${actor.name})`, data: { course, feeAmount } });
  return applyAttribution(leadId, actor);
}
