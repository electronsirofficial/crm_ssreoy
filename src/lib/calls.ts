import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { readStored } from "./storage";
import { transcribe, transcriptionProvider } from "./transcribe";
import { analyzeCallTranscript } from "./ai/callAnalysis";
import { aiConfigured } from "./ai/claude";
import { raiseFlag } from "./flags";
import { logActivity } from "./audit";
import { getSettings } from "./settings";

/** Transcribe (if needed) and analyse a call. Safe to re-run. Never throws — failures are stored on the call. */
export async function processCall(callId: string) {
  let call = await prisma.call.findUniqueOrThrow({ where: { id: callId }, include: { lead: true } });

  if (!call.transcript && call.recordingPath) {
    if (transcriptionProvider() === "none") {
      await prisma.call.update({
        where: { id: callId },
        data: { transcriptStatus: "SKIPPED", transcriptError: "No transcription provider configured — paste a transcript to analyse.", analysisStatus: "SKIPPED" },
      });
      return;
    }
    await prisma.call.update({ where: { id: callId }, data: { transcriptStatus: "PROCESSING", transcriptError: null } });
    try {
      const audio = await readStored(call.recordingPath);
      const transcript = await transcribe(audio, call.recordingMime ?? "audio/mpeg");
      call = await prisma.call.update({ where: { id: callId }, data: { transcript, transcriptStatus: "DONE" }, include: { lead: true } });
    } catch (e) {
      await prisma.call.update({
        where: { id: callId },
        data: { transcriptStatus: "FAILED", transcriptError: (e as Error).message, analysisStatus: "SKIPPED" },
      });
      return;
    }
  }

  if (!call.transcript) return;
  if (!aiConfigured()) {
    await prisma.call.update({ where: { id: callId }, data: { analysisStatus: "SKIPPED", analysisError: "ANTHROPIC_API_KEY is not set." } });
    return;
  }

  await prisma.call.update({ where: { id: callId }, data: { analysisStatus: "PROCESSING", analysisError: null } });
  try {
    const criteria = await prisma.evaluationCriterion.findMany({ where: { active: true }, orderBy: { order: "asc" } });
    const a = await analyzeCallTranscript({
      transcript: call.transcript,
      criteria,
      agentReport: { outcome: call.reportedOutcome, interest: call.reportedInterest, notes: call.reportedNotes },
      lead: call.lead,
      durationSec: call.durationSec,
    });

    // Quality is a weighted average of the configured criteria, so admins control what matters.
    const byKey = new Map(a.criteria.map((c) => [c.key, c]));
    let wSum = 0;
    let total = 0;
    const evaluation = criteria.map((c) => {
      const r = byKey.get(c.key);
      const score = r?.score ?? 0;
      wSum += c.weight;
      total += score * c.weight;
      return { key: c.key, label: c.label, weight: c.weight, score, comment: r?.comment ?? "Not assessed" };
    });
    const qualityScore = wSum ? Math.round((total / wSum) * 10) : 0;

    await prisma.call.update({
      where: { id: callId },
      data: {
        summary: a.summary,
        qualityScore,
        conversionScore: a.conversionLikelihood,
        evaluation: evaluation as Prisma.InputJsonValue,
        discrepancies: a.discrepancies as Prisma.InputJsonValue,
        aiInsights: {
          meaningfulConversation: a.meaningfulConversation,
          invitedToVisit: a.invitedToVisit,
          visitCommitted: a.visitCommitted,
          spokeWith: a.spokeWith,
          prospectInterest: a.prospectInterest,
          extracted: a.extracted,
          nextAction: a.nextAction,
          suggestedFollowUpDays: a.suggestedFollowUpDays,
          integrityConcerns: a.integrityConcerns,
        },
        analysisStatus: "DONE",
        analyzedAt: new Date(),
      },
    });

    // Fill gaps in the lead record from what was actually said.
    const lead = call.lead;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        classLevel: lead.classLevel ?? a.extracted.studentClass ?? undefined,
        targetExam: lead.targetExam === "UNKNOWN" ? a.extracted.targetExam : undefined,
        aiConversion: a.conversionLikelihood,
        aiNextAction: a.nextAction,
        aiUpdatedAt: new Date(),
      },
    });

    const settings = await getSettings();
    const high = a.discrepancies.filter((d) => d.severity !== "LOW");
    if (high.length) {
      await raiseFlag({
        type: "CALL_DISCREPANCY",
        severity: high.some((d) => d.severity === "HIGH") ? "HIGH" : "MEDIUM",
        message: `Agent's report disagrees with the recording: ${high[0].agentClaim}`,
        agentId: call.agentId,
        leadId: call.leadId,
        callId,
        details: high as Prisma.InputJsonValue,
        dedupeKey: `CALL_DISCREPANCY:${callId}`,
      });
    }
    if (a.integrityConcerns.length) {
      await raiseFlag({
        type: "CALL_INTEGRITY",
        severity: "HIGH",
        message: a.integrityConcerns[0],
        agentId: call.agentId,
        leadId: call.leadId,
        callId,
        details: a.integrityConcerns,
        dedupeKey: `CALL_INTEGRITY:${callId}`,
      });
    }
    await logActivity({
      leadId: call.leadId,
      type: "CALL_ANALYZED",
      message: `Call analysed: quality ${qualityScore}/100, conversion ${a.conversionLikelihood}%${qualityScore < settings.call.minQualityScore ? " (below commission threshold)" : ""}`,
      data: { callId, qualityScore, meaningful: a.meaningfulConversation, invited: a.invitedToVisit },
    });
  } catch (e) {
    await prisma.call.update({ where: { id: callId }, data: { analysisStatus: "FAILED", analysisError: (e as Error).message } });
  }
}
