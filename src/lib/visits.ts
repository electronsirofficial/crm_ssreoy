import { Prisma, type FlagSeverity, type User } from "@prisma/client";
import { prisma } from "./db";
import { distanceM } from "./geo";
import { dHash, hamming, watermark } from "./image";
import { saveFile, sha256 } from "./storage";
import { getSettings, type CrmSettings } from "./settings";
import { raiseFlag } from "./flags";
import { logActivity } from "./audit";

export type GeoInput = { lat: number; lng: number; accuracy: number | null; clientAt: Date | null };

export class VisitError extends Error {}

/** Visits whose questionnaire is still owed. Agents must clear these before starting another visit. */
export async function pendingQuestionnaires(agentId: string) {
  return prisma.fieldVisit.findMany({
    where: { agentId, status: "COMPLETED", questionnaire: null },
    include: { lead: { select: { studentName: true } } },
    orderBy: { checkOutAt: "asc" },
  });
}

export async function checkIn(agent: User, leadId: string, photo: Buffer, geo: GeoInput, meta: { userAgent: string | null; ip: string | null }) {
  const open = await prisma.fieldVisit.findFirst({ where: { agentId: agent.id, status: "IN_PROGRESS" } });
  if (open) throw new VisitError("You already have a visit in progress. Check out of it first.");
  if ((await pendingQuestionnaires(agent.id)).length) throw new VisitError("Submit the questionnaire for your previous visit first.");

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new VisitError("Lead not found");

  const now = new Date();
  const photoHash = sha256(photo);
  const photoDHash = await dHash(photo).catch(() => null);
  const stamped = await watermark(photo, [
    `${lead.studentName} · ${agent.name}`,
    `${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} ±${Math.round(geo.accuracy ?? 0)}m`,
    `CHECK-IN ${now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST (server)`,
  ]);
  const photoPath = await saveFile("photos", stamped.buffer, "jpg");

  const visit = await prisma.fieldVisit.create({
    data: {
      leadId,
      agentId: agent.id,
      checkInAt: now,
      checkInClientAt: geo.clientAt,
      checkInLat: geo.lat,
      checkInLng: geo.lng,
      checkInAccuracy: geo.accuracy,
      photoPath,
      photoHash,
      photoDHash,
      photoWidth: stamped.width,
      photoHeight: stamped.height,
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
    },
  });
  if (lead.stageKey === "NEW" || lead.stageKey === "CONTACTED") {
    await prisma.lead.update({ where: { id: leadId }, data: { stageKey: "INTERESTED" } }).catch(() => undefined);
  }
  await logActivity({
    leadId,
    actorId: agent.id,
    type: "VISIT_CHECK_IN",
    message: `${agent.name} checked in at the family's location`,
    data: { visitId: visit.id, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, photoHash },
  });
  return visit;
}

export async function checkOut(agent: User, visitId: string, geo: GeoInput) {
  const visit = await prisma.fieldVisit.findUnique({ where: { id: visitId } });
  if (!visit || visit.agentId !== agent.id) throw new VisitError("Visit not found");
  if (visit.status !== "IN_PROGRESS") throw new VisitError("This visit is already closed");

  const now = new Date();
  const durationMin = Math.round((now.getTime() - visit.checkInAt.getTime()) / 60000);
  await prisma.fieldVisit.update({
    where: { id: visitId },
    data: {
      status: "COMPLETED",
      checkOutAt: now,
      checkOutClientAt: geo.clientAt,
      checkOutLat: geo.lat,
      checkOutLng: geo.lng,
      checkOutAccuracy: geo.accuracy,
      durationMin,
      checkInOutDriftM: distanceM(visit.checkInLat, visit.checkInLng, geo.lat, geo.lng),
    },
  });
  await prisma.lead.update({ where: { id: visit.leadId }, data: { stageKey: "HOME_VISIT_DONE" } });
  await logActivity({
    leadId: visit.leadId,
    actorId: agent.id,
    type: "VISIT_CHECK_OUT",
    message: `${agent.name} checked out after ${durationMin} min`,
    data: { visitId, lat: geo.lat, lng: geo.lng, durationMin },
  });
  return verifyVisit(visitId);
}

type Check = { check: string; label: string; weight: number; passed: boolean | null; detail: string };

/**
 * Scores a visit from independent evidence checks and raises flags for failures. Deterministic and
 * idempotent: re-run after the questionnaire is submitted or when settings change.
 */
export async function verifyVisit(visitId: string) {
  const s = await getSettings();
  const v = await prisma.fieldVisit.findUniqueOrThrow({
    where: { id: visitId },
    include: { lead: true, agent: true, questionnaire: true },
  });
  const checks: Check[] = [];
  const flags: { type: string; severity: FlagSeverity; message: string; details?: Prisma.InputJsonValue }[] = [];
  const vs = s.visit;

  // 1. GPS accuracy
  const acc = v.checkInAccuracy ?? 9999;
  checks.push({ check: "gps_accuracy", label: "GPS accuracy", weight: 10, passed: acc <= vs.maxGpsAccuracyM, detail: `±${Math.round(acc)} m (max ${vs.maxGpsAccuracyM} m)` });
  if (acc > vs.maxGpsAccuracyM) flags.push({ type: "GPS_LOW_ACCURACY", severity: "LOW", message: `Check-in GPS accuracy was ±${Math.round(acc)} m` });

  // 2. Duration
  if (v.durationMin != null) {
    const ok = v.durationMin >= vs.minDurationMin && v.durationMin <= vs.maxDurationMin;
    checks.push({ check: "duration", label: "Time spent", weight: 25, passed: ok, detail: `${v.durationMin} min (expected ${vs.minDurationMin}–${vs.maxDurationMin})` });
    if (v.durationMin < vs.minDurationMin)
      flags.push({ type: "SHORT_VISIT", severity: v.durationMin < vs.minDurationMin / 2 ? "HIGH" : "MEDIUM", message: `Visit lasted only ${v.durationMin} min` });
    if (v.durationMin > vs.maxDurationMin) flags.push({ type: "LONG_VISIT", severity: "LOW", message: `Visit lasted ${v.durationMin} min` });
  }

  // 3. Check-in vs check-out location
  if (v.checkInOutDriftM != null) {
    const ok = v.checkInOutDriftM <= vs.maxCheckInOutDriftM;
    checks.push({ check: "drift", label: "Stayed at location", weight: 10, passed: ok, detail: `Check-out ${v.checkInOutDriftM} m from check-in (max ${vs.maxCheckInOutDriftM} m)` });
    if (!ok) flags.push({ type: "GPS_DRIFT", severity: "MEDIUM", message: `Checked out ${v.checkInOutDriftM} m away from the check-in point` });
  }

  // 4. Distance from the family's known home location
  if (v.lead.homeLat != null && v.lead.homeLng != null) {
    const d = distanceM(v.lead.homeLat, v.lead.homeLng, v.checkInLat, v.checkInLng);
    const ok = d <= vs.maxDistanceFromHomeM;
    checks.push({ check: "home_distance", label: "Matches family's address", weight: 15, passed: ok, detail: `${d} m from recorded home location (max ${vs.maxDistanceFromHomeM} m)` });
    if (!ok) flags.push({ type: "GPS_FAR_FROM_HOME", severity: d > vs.maxDistanceFromHomeM * 5 ? "HIGH" : "MEDIUM", message: `Check-in was ${d} m from the family's recorded home` });
    await prisma.fieldVisit.update({ where: { id: v.id }, data: { distanceFromHomeM: d } });
  } else {
    checks.push({ check: "home_distance", label: "Matches family's address", weight: 15, passed: null, detail: "No reference location yet — this visit will set it if verified" });
  }

  // 5. Photo reuse (exact bytes or perceptually similar)
  const exact = await prisma.fieldVisit.findFirst({ where: { photoHash: v.photoHash, id: { not: v.id } }, select: { id: true, leadId: true } });
  let near: { id: string; distance: number } | null = null;
  if (!exact && v.photoDHash) {
    const others = await prisma.fieldVisit.findMany({
      where: { id: { not: v.id }, photoDHash: { not: null }, checkInAt: { gte: new Date(Date.now() - 180 * 864e5) } },
      select: { id: true, photoDHash: true, leadId: true },
      take: 2000,
      orderBy: { checkInAt: "desc" },
    });
    for (const o of others) {
      const dist = hamming(v.photoDHash, o.photoDHash!);
      if (dist <= 5 && o.leadId !== v.leadId) {
        near = { id: o.id, distance: dist };
        break;
      }
    }
  }
  checks.push({ check: "photo_unique", label: "Fresh photo", weight: 20, passed: !exact && !near, detail: exact ? "Identical photo used in another visit" : near ? "Nearly identical to another family's visit photo" : "Unique" });
  if (exact) flags.push({ type: "PHOTO_REUSE", severity: "HIGH", message: "This photo was already submitted for another visit", details: { otherVisitId: exact.id } });
  if (near) flags.push({ type: "PHOTO_NEAR_DUPLICATE", severity: "HIGH", message: "Photo is almost identical to one from a different family's visit", details: { otherVisitId: near.id, distance: near.distance } });

  // 6. Plausible travel from the agent's previous visit
  const prev = await prisma.fieldVisit.findFirst({
    where: { agentId: v.agentId, id: { not: v.id }, checkInAt: { lt: v.checkInAt } },
    orderBy: { checkInAt: "desc" },
  });
  if (prev) {
    const fromLat = prev.checkOutLat ?? prev.checkInLat;
    const fromLng = prev.checkOutLng ?? prev.checkInLng;
    const fromAt = prev.checkOutAt ?? prev.checkInAt;
    const km = distanceM(fromLat, fromLng, v.checkInLat, v.checkInLng) / 1000;
    const hours = Math.max((v.checkInAt.getTime() - fromAt.getTime()) / 36e5, 1 / 60);
    const speed = Math.round(km / hours);
    const ok = km < 1 || speed <= vs.maxTravelSpeedKmh;
    checks.push({ check: "travel", label: "Plausible travel", weight: 5, passed: ok, detail: `${km.toFixed(1)} km from previous visit at ~${speed} km/h` });
    if (!ok) flags.push({ type: "IMPOSSIBLE_TRAVEL", severity: "HIGH", message: `Travelled ${km.toFixed(1)} km since the previous visit at ~${speed} km/h`, details: { previousVisitId: prev.id } });
  }

  // 7. Device clock vs server (large skew suggests a tampered device)
  if (v.checkInClientAt) {
    const skew = Math.round(Math.abs(v.checkInClientAt.getTime() - v.checkInAt.getTime()) / 60000);
    const ok = skew <= vs.maxClientSkewMin;
    checks.push({ check: "clock", label: "Device clock", weight: 5, passed: ok, detail: `${skew} min difference from server time` });
    if (!ok) flags.push({ type: "CLOCK_SKEW", severity: "MEDIUM", message: `Device clock differed from server by ${skew} min` });
  }

  // 8. Same spot used for a different family (agent submitting from one place)
  const nearby = await prisma.fieldVisit.findMany({
    where: {
      agentId: v.agentId,
      id: { not: v.id },
      leadId: { not: v.leadId },
      checkInLat: { gte: v.checkInLat - 0.001, lte: v.checkInLat + 0.001 },
      checkInLng: { gte: v.checkInLng - 0.001, lte: v.checkInLng + 0.001 },
    },
    include: { lead: { select: { phone: true, address: true } } },
    take: 20,
  });
  const sameSpot = nearby.filter((o) => distanceM(o.checkInLat, o.checkInLng, v.checkInLat, v.checkInLng) <= vs.sameSpotRadiusM);
  checks.push({ check: "same_spot", label: "Distinct location", weight: 5, passed: sameSpot.length < 2, detail: sameSpot.length ? `${sameSpot.length} other families recorded at this exact spot` : "Unique to this family" });
  if (sameSpot.length >= 2)
    flags.push({ type: "GPS_SAME_SPOT", severity: "MEDIUM", message: `${sameSpot.length} other families' visits were recorded within ${vs.sameSpotRadiusM} m of this spot`, details: { visitIds: sameSpot.map((o) => o.id) } });

  // 9. Questionnaire
  if (v.status === "COMPLETED") {
    const deadline = v.checkOutAt ? new Date(v.checkOutAt.getTime() + vs.questionnaireDeadlineHours * 36e5) : null;
    if (v.questionnaire) {
      const q = v.questionnaire;
      const rushed = q.fillSeconds < vs.minQuestionnaireSeconds;
      const late = deadline ? q.submittedAt > deadline : false;
      const ok = !rushed && !late && q.completeness >= 80;
      checks.push({ check: "questionnaire", label: "Questionnaire", weight: 10, passed: ok, detail: `${q.completeness}% complete in ${q.fillSeconds}s${late ? ", submitted late" : ""}` });
      if (rushed) flags.push({ type: "QUESTIONNAIRE_RUSHED", severity: "LOW", message: `Questionnaire completed in ${q.fillSeconds}s` });
      if (late) flags.push({ type: "QUESTIONNAIRE_LATE", severity: "LOW", message: "Questionnaire submitted after the deadline" });
    } else if (deadline && deadline < new Date()) {
      checks.push({ check: "questionnaire", label: "Questionnaire", weight: 10, passed: false, detail: "Not submitted before deadline" });
      flags.push({ type: "QUESTIONNAIRE_LATE", severity: "MEDIUM", message: "Questionnaire not submitted" });
    } else {
      checks.push({ check: "questionnaire", label: "Questionnaire", weight: 10, passed: null, detail: "Pending" });
    }
  }

  const scored = checks.filter((c) => c.passed !== null);
  const total = scored.reduce((a, c) => a + c.weight, 0);
  let score = total ? Math.round((scored.filter((c) => c.passed).reduce((a, c) => a + c.weight, 0) / total) * 100) : null;
  // A recycled photo means the evidence itself is fabricated — no other check can make up for it.
  if (score != null && (exact || near)) score = Math.min(score, 30);

  await prisma.fieldVisit.update({
    where: { id: v.id },
    data: { verificationScore: score, verificationNotes: checks as unknown as Prisma.InputJsonValue },
  });

  // First well-verified visit establishes the family's reference location for future visits.
  if (v.lead.homeLat == null && v.status === "COMPLETED" && score != null && score >= vs.minVerificationScore && !exact && !near) {
    await prisma.lead.update({ where: { id: v.leadId }, data: { homeLat: v.checkInLat, homeLng: v.checkInLng } });
  }

  for (const f of flags) {
    await raiseFlag({ ...f, agentId: v.agentId, leadId: v.leadId, visitId: v.id, dedupeKey: `${f.type}:${v.id}` });
  }
  return { score, checks };
}

export function visitQualifies(v: { status: string; verificationScore: number | null; durationMin: number | null; questionnaire: unknown }, s: CrmSettings) {
  return (
    v.status === "COMPLETED" &&
    v.verificationScore != null &&
    v.verificationScore >= s.visit.minVerificationScore &&
    (v.durationMin ?? 0) >= s.visit.minDurationMin &&
    Boolean(v.questionnaire)
  );
}
