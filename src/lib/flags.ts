import { Prisma, type FlagSeverity } from "@prisma/client";
import { prisma } from "./db";

export const FLAG_LABELS: Record<string, string> = {
  SHORT_VISIT: "Visit shorter than minimum",
  LONG_VISIT: "Visit unusually long / never closed",
  PHOTO_REUSE: "Photo reused from another visit",
  PHOTO_NEAR_DUPLICATE: "Photo nearly identical to another visit",
  GPS_LOW_ACCURACY: "Poor GPS accuracy",
  GPS_FAR_FROM_HOME: "Location far from family's home",
  GPS_DRIFT: "Check-out far from check-in",
  GPS_SAME_SPOT: "Same spot used for different families",
  IMPOSSIBLE_TRAVEL: "Impossible travel speed between visits",
  CLOCK_SKEW: "Device clock does not match server",
  QUESTIONNAIRE_RUSHED: "Questionnaire filled too quickly",
  QUESTIONNAIRE_LATE: "Questionnaire not submitted in time",
  REPEATED_SHORT_VISITS: "Repeated short visits",
  DUPLICATE_CLAIM: "Another agent already has this lead",
  CLAIM_ON_WALK_IN: "Agent claimed a family that already walked in",
  MULTI_AGENT_ATTRIBUTION: "Multiple agents qualify for one admission",
  CALL_DISCREPANCY: "Agent report contradicts call recording",
  CALL_INTEGRITY: "Call recording looks staged or manipulated",
  RECORDING_REUSE: "Same recording uploaded twice",
  LATE_CALL_UPLOAD: "Recording uploaded long after the call",
  POOR_CALL_PATTERN: "Repeatedly poor-quality calls",
  DATA_INCONSISTENCY: "Call and visit information disagree",
  HOT_LEAD_NEGLECTED: "High-potential lead not followed up",
};

export async function raiseFlag(f: {
  type: string;
  severity: FlagSeverity;
  message: string;
  agentId?: string | null;
  leadId?: string | null;
  callId?: string | null;
  visitId?: string | null;
  details?: Prisma.InputJsonValue;
  dedupeKey?: string;
}) {
  const data = {
    type: f.type,
    severity: f.severity,
    message: f.message,
    agentId: f.agentId ?? null,
    leadId: f.leadId ?? null,
    callId: f.callId ?? null,
    visitId: f.visitId ?? null,
    details: f.details ?? Prisma.JsonNull,
    dedupeKey: f.dedupeKey ?? null,
  };
  if (!f.dedupeKey) return prisma.fraudFlag.create({ data });
  // Re-running checks must not duplicate flags (or re-open ones an admin already reviewed).
  return prisma.fraudFlag.upsert({ where: { dedupeKey: f.dedupeKey }, create: data, update: {} });
}
