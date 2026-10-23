import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { aiConfigured } from "./ai/claude";
import { leadInsight, agentInsight } from "./ai/insights";
import { raiseFlag } from "./flags";
import { getSettings } from "./settings";
import { verifyVisit } from "./visits";

const d = (x: Date) => x.toISOString().slice(0, 16).replace("T", " ");

export async function buildLeadHistory(leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      calls: { include: { agent: true }, orderBy: { calledAt: "asc" } },
      visits: { include: { agent: true, questionnaire: true }, orderBy: { checkInAt: "asc" } },
      followUps: { orderBy: { dueAt: "asc" } },
    },
  });
  const questions = await prisma.questionnaireQuestion.findMany();
  const qText = new Map(questions.map((q) => [q.key, q.text]));
  const lines: string[] = [
    `Today: ${d(new Date())}`,
    `Student: ${lead.studentName}; parent: ${lead.parentName ?? "?"}; class: ${lead.classLevel ?? "?"}; exam: ${lead.targetExam}; school: ${lead.school ?? "?"}; locality: ${lead.locality ?? "?"}`,
    `Source: ${lead.source}; stage: ${lead.stageKey}; created ${d(lead.createdAt)}${lead.walkInAt ? `; came to institute ${d(lead.walkInAt)}` : ""}`,
  ];
  if (lead.notes) lines.push(`<notes>${lead.notes}</notes>`);
  for (const c of lead.calls) {
    lines.push(
      `\nCALL ${d(c.calledAt)} by ${c.agent.name}, ${c.durationSec ?? "?"}s, quality ${c.qualityScore ?? "n/a"}`,
      `Agent reported: outcome=${c.reportedOutcome ?? "-"}, interest=${c.reportedInterest ?? "-"}`,
      c.summary ? `AI summary: ${c.summary}` : c.transcript ? `<transcript>${c.transcript.slice(0, 6000)}</transcript>` : "(no transcript)",
    );
  }
  for (const v of lead.visits) {
    lines.push(`\nHOME VISIT ${d(v.checkInAt)} by ${v.agent.name}, ${v.durationMin ?? "?"} min, verification ${v.verificationScore ?? "n/a"}/100`);
    if (v.questionnaire) {
      const answers = v.questionnaire.answers as Record<string, unknown>;
      lines.push(
        "<questionnaire>",
        ...Object.entries(answers).map(([k, val]) => `${qText.get(k) ?? k}: ${Array.isArray(val) ? val.join(", ") : String(val)}`),
        "</questionnaire>",
      );
    }
  }
  for (const f of lead.followUps) {
    lines.push(`FOLLOW-UP ${f.type} due ${d(f.dueAt)} — ${f.status}${f.outcome ? ` (${f.outcome})` : ""}${f.notes ? ` notes: ${f.notes}` : ""}`);
  }
  return { lead, text: lines.join("\n") };
}

export async function refreshLeadInsight(leadId: string) {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY is not set");
  const { lead, text } = await buildLeadHistory(leadId);
  const r = await leadInsight(text);
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      aiConversion: r.conversionLikelihood,
      aiPriority: r.priority,
      aiNextAction: [r.nextAction, ...r.talkingPoints.map((t) => `• ${t}`)].join("\n"),
      aiUpdatedAt: new Date(),
    },
  });
  for (const inc of r.inconsistencies.filter((i) => i.severity !== "LOW")) {
    await raiseFlag({
      type: "DATA_INCONSISTENCY",
      severity: inc.severity,
      message: inc.description,
      leadId,
      agentId: lead.assignedToId,
      dedupeKey: `DATA_INCONSISTENCY:${leadId}:${inc.description.slice(0, 80)}`,
    });
  }
  return r;
}

export async function buildAgentProfile(agentId: string) {
  const since = new Date(Date.now() - 30 * 864e5);
  const [agent, calls, visits, flags, commissions, overdue] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: agentId } }),
    prisma.call.findMany({ where: { agentId, calledAt: { gte: since } }, include: { lead: { select: { studentName: true } } }, orderBy: { calledAt: "desc" }, take: 40 }),
    prisma.fieldVisit.findMany({ where: { agentId, checkInAt: { gte: since } }, include: { questionnaire: { select: { fillSeconds: true, completeness: true } } }, orderBy: { checkInAt: "desc" }, take: 40 }),
    prisma.fraudFlag.findMany({ where: { agentId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.commission.findMany({ where: { agentId }, select: { status: true, attribution: true } }),
    prisma.followUp.count({ where: { agentId, status: "PENDING", dueAt: { lt: new Date() } } }),
  ]);
  const lines = [
    `Agent: ${agent.name}. Last 30 days.`,
    `Calls: ${calls.length}. Visits: ${visits.length}. Overdue follow-ups now: ${overdue}.`,
    `Commissions: ${commissions.map((c) => `${c.attribution}/${c.status}`).join(", ") || "none"}`,
    "\nCALLS:",
    ...calls.map((c) => `${d(c.calledAt)} ${c.lead.studentName}: ${c.durationSec ?? "?"}s, quality ${c.qualityScore ?? "n/a"}, agent said "${c.reportedOutcome ?? "-"}"; AI: ${c.summary ?? "n/a"}`),
    "\nVISITS:",
    ...visits.map((v) => `${d(v.checkInAt)}: ${v.durationMin ?? "?"} min, verification ${v.verificationScore ?? "n/a"}, questionnaire ${v.questionnaire ? `${v.questionnaire.completeness}% in ${v.questionnaire.fillSeconds}s` : "missing"}`),
    "\nFLAGS:",
    ...flags.map((f) => `${d(f.createdAt)} [${f.severity}/${f.status}] ${f.type}: ${f.message}`),
  ];
  return lines.join("\n");
}

export async function runAgentInsight(agentId: string) {
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY is not set");
  const r = await agentInsight(await buildAgentProfile(agentId));
  await prisma.setting.upsert({
    where: { key: `agent-insight:${agentId}` },
    create: { key: `agent-insight:${agentId}`, value: { ...r, at: new Date().toISOString() } as Prisma.InputJsonValue },
    update: { value: { ...r, at: new Date().toISOString() } as Prisma.InputJsonValue },
  });
  return r;
}

/**
 * Pattern checks across records (cheap, rule-based; safe to run often).
 * Wire /api/cron/sweep to a scheduler, or it runs when admins open the dashboard.
 */
export async function runSweep() {
  const s = await getSettings();
  const now = Date.now();
  let raised = 0;

  // Questionnaires past their deadline — re-verify so the visit score reflects it.
  const late = await prisma.fieldVisit.findMany({
    where: { status: "COMPLETED", questionnaire: null, checkOutAt: { lt: new Date(now - s.visit.questionnaireDeadlineHours * 36e5) } },
    select: { id: true },
    take: 200,
  });
  for (const v of late) await verifyVisit(v.id);

  // Visits left open for far too long.
  const stale = await prisma.fieldVisit.findMany({
    where: { status: "IN_PROGRESS", checkInAt: { lt: new Date(now - s.visit.maxDurationMin * 60000) } },
  });
  for (const v of stale) {
    await prisma.fieldVisit.update({ where: { id: v.id }, data: { status: "ABANDONED" } });
    await raiseFlag({ type: "LONG_VISIT", severity: "LOW", message: "Visit was never checked out", agentId: v.agentId, leadId: v.leadId, visitId: v.id, dedupeKey: `LONG_VISIT:${v.id}` });
    raised++;
  }

  // Repeated short visits per agent (last 14 days).
  const shortVisits = await prisma.fieldVisit.groupBy({
    by: ["agentId"],
    where: { status: "COMPLETED", durationMin: { lt: s.visit.minDurationMin }, checkInAt: { gte: new Date(now - 14 * 864e5) } },
    _count: true,
  });
  const week = Math.floor(now / (7 * 864e5));
  for (const g of shortVisits.filter((g) => g._count >= 3)) {
    await raiseFlag({
      type: "REPEATED_SHORT_VISITS",
      severity: "HIGH",
      message: `${g._count} visits under ${s.visit.minDurationMin} min in the last 14 days`,
      agentId: g.agentId,
      dedupeKey: `REPEATED_SHORT_VISITS:${g.agentId}:${week}`,
    });
    raised++;
  }

  // Consistently poor calls.
  const agents = await prisma.user.findMany({ where: { role: "AGENT", active: true }, select: { id: true } });
  for (const a of agents) {
    const recent = await prisma.call.findMany({ where: { agentId: a.id, qualityScore: { not: null } }, orderBy: { calledAt: "desc" }, take: 10, select: { qualityScore: true } });
    if (recent.length >= 5) {
      const avg = recent.reduce((x, c) => x + (c.qualityScore ?? 0), 0) / recent.length;
      if (avg < 40) {
        await raiseFlag({ type: "POOR_CALL_PATTERN", severity: "MEDIUM", message: `Average call quality ${Math.round(avg)} over last ${recent.length} calls`, agentId: a.id, dedupeKey: `POOR_CALL_PATTERN:${a.id}:${week}` });
        raised++;
      }
    }
  }

  // Hot leads going cold.
  const hot = await prisma.lead.findMany({
    where: { aiConversion: { gte: s.ai.hotLeadThreshold }, stageKey: { notIn: ["ENROLLED", "LOST"] } },
    include: { followUps: { where: { status: "PENDING" } }, calls: { orderBy: { calledAt: "desc" }, take: 1 }, visits: { orderBy: { checkInAt: "desc" }, take: 1 } },
  });
  for (const l of hot) {
    const lastTouch = Math.max(l.calls[0]?.calledAt.getTime() ?? 0, l.visits[0]?.checkInAt.getTime() ?? 0, l.createdAt.getTime());
    const hasFuturePlan = l.followUps.some((f) => f.dueAt.getTime() > now);
    if (!hasFuturePlan && now - lastTouch > s.ai.neglectHours * 36e5) {
      await raiseFlag({
        type: "HOT_LEAD_NEGLECTED",
        severity: "MEDIUM",
        message: `${l.studentName} (${l.aiConversion}% likely) has had no contact for ${Math.round((now - lastTouch) / 864e5)} days and no upcoming follow-up`,
        agentId: l.assignedToId,
        leadId: l.id,
        dedupeKey: `HOT_LEAD_NEGLECTED:${l.id}:${week}`,
      });
      raised++;
    }
  }

  await prisma.setting.upsert({ where: { key: "last-sweep" }, create: { key: "last-sweep", value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  return { raised };
}

export async function maybeSweep() {
  const row = await prisma.setting.findUnique({ where: { key: "last-sweep" } });
  const last = row ? new Date(row.value as string).getTime() : 0;
  if (Date.now() - last > 15 * 60000) await runSweep();
}
