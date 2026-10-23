import { prisma } from "./db";

export type CrmSettings = {
  commission: {
    amountPerEnrollment: number; // INR
    attributionWindowDays: number; // evidence older than this before enrollment is ignored
    model: "FIRST_QUALIFYING" | "LAST_QUALIFYING"; // which agent is suggested when several qualify
    requireAdminApproval: boolean;
  };
  call: {
    minDurationSec: number;
    minQualityScore: number;
    requireRecording: boolean;
    lateUploadGraceHours: number; // a recording uploaded this long after the call is treated as suspicious
  };
  visit: {
    minDurationMin: number;
    maxDurationMin: number;
    maxGpsAccuracyM: number;
    maxDistanceFromHomeM: number;
    maxCheckInOutDriftM: number;
    minVerificationScore: number;
    questionnaireDeadlineHours: number;
    minQuestionnaireSeconds: number;
    maxTravelSpeedKmh: number;
    maxClientSkewMin: number;
    sameSpotRadiusM: number;
  };
  ai: {
    hotLeadThreshold: number; // conversion % at which a neglected lead is flagged
    neglectHours: number;
  };
};

export const DEFAULT_SETTINGS: CrmSettings = {
  commission: { amountPerEnrollment: 2000, attributionWindowDays: 90, model: "FIRST_QUALIFYING", requireAdminApproval: true },
  call: { minDurationSec: 60, minQualityScore: 50, requireRecording: true, lateUploadGraceHours: 24 },
  visit: {
    minDurationMin: 15,
    maxDurationMin: 240,
    maxGpsAccuracyM: 100,
    maxDistanceFromHomeM: 300,
    maxCheckInOutDriftM: 200,
    minVerificationScore: 60,
    questionnaireDeadlineHours: 12,
    minQuestionnaireSeconds: 60,
    maxTravelSpeedKmh: 80,
    maxClientSkewMin: 10,
    sameSpotRadiusM: 40,
  },
  ai: { hotLeadThreshold: 70, neglectHours: 72 },
};

export async function getSettings(): Promise<CrmSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "crm" } });
  const stored = (row?.value ?? {}) as Partial<CrmSettings>;
  return {
    commission: { ...DEFAULT_SETTINGS.commission, ...stored.commission },
    call: { ...DEFAULT_SETTINGS.call, ...stored.call },
    visit: { ...DEFAULT_SETTINGS.visit, ...stored.visit },
    ai: { ...DEFAULT_SETTINGS.ai, ...stored.ai },
  };
}

export async function saveSettings(value: CrmSettings) {
  await prisma.setting.upsert({ where: { key: "crm" }, create: { key: "crm", value }, update: { value } });
}
