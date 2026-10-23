import { NextResponse, after } from "next/server";
import { apiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { leadForUser } from "@/lib/access";
import { saveFile, sha256 } from "@/lib/storage";
import { processCall } from "@/lib/calls";
import { raiseFlag } from "@/lib/flags";
import { logActivity } from "@/lib/audit";
import { getSettings } from "@/lib/settings";

export const maxDuration = 300;
const MAX_BYTES = 50 * 1024 * 1024;

/** Agent uploads a call recording (or a transcript) for one of their leads. */
export async function POST(req: Request) {
  const user = await apiUser(["AGENT", "ADMIN"]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData();
  const leadId = String(form.get("leadId") ?? "");
  const lead = await leadForUser(user, leadId);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const calledAt = new Date(String(form.get("calledAt") ?? ""));
  if (isNaN(calledAt.getTime())) return NextResponse.json({ error: "Call date/time is required" }, { status: 400 });
  if (calledAt.getTime() > Date.now() + 5 * 60000) return NextResponse.json({ error: "Call time cannot be in the future" }, { status: 400 });
  if (form.get("consent") !== "on") return NextResponse.json({ error: "Confirm the caller was informed the call is recorded" }, { status: 400 });

  const file = form.get("recording");
  const transcript = String(form.get("transcript") ?? "").trim() || null;
  const settings = await getSettings();
  if (!(file instanceof File && file.size) && !transcript)
    return NextResponse.json({ error: settings.call.requireRecording ? "Attach the call recording" : "Attach a recording or paste a transcript" }, { status: 400 });

  let recordingPath: string | null = null;
  let recordingHash: string | null = null;
  let recordingMime: string | null = null;
  if (file instanceof File && file.size) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Recording is larger than 50 MB" }, { status: 400 });
    if (!/^audio\/|^video\/(mp4|webm)/.test(file.type)) return NextResponse.json({ error: "Unsupported file type — upload an audio file" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    recordingHash = sha256(buf);
    const dup = await prisma.call.findFirst({ where: { recordingHash }, select: { id: true, leadId: true, agentId: true } });
    if (dup) {
      await raiseFlag({
        type: "RECORDING_REUSE",
        severity: "HIGH",
        message: `${user.name} tried to upload a recording that was already submitted`,
        agentId: user.id,
        leadId,
        details: { existingCallId: dup.id, existingLeadId: dup.leadId },
        dedupeKey: `RECORDING_REUSE:${recordingHash}:${leadId}`,
      });
      return NextResponse.json({ error: "This recording has already been uploaded." }, { status: 409 });
    }
    recordingMime = file.type;
    recordingPath = await saveFile("recordings", buf, file.name.split(".").pop() || "mp3");
  }

  const durationSec = Number(form.get("durationSec")) || null;
  const call = await prisma.call.create({
    data: {
      leadId,
      agentId: user.id,
      phoneNumber: lead.phone,
      calledAt,
      durationSec,
      recordingPath,
      recordingHash,
      recordingMime,
      consentConfirmed: true,
      reportedOutcome: String(form.get("reportedOutcome") ?? "") || null,
      reportedInterest: String(form.get("reportedInterest") ?? "") || null,
      reportedNotes: String(form.get("reportedNotes") ?? "") || null,
      transcript,
      transcriptStatus: transcript ? "DONE" : "PENDING",
    },
  });

  const lateHours = (Date.now() - calledAt.getTime()) / 36e5;
  if (lateHours > settings.call.lateUploadGraceHours) {
    await raiseFlag({
      type: "LATE_CALL_UPLOAD",
      severity: lateHours > settings.call.lateUploadGraceHours * 3 ? "MEDIUM" : "LOW",
      message: `Recording uploaded ${Math.round(lateHours)} h after the reported call time`,
      agentId: user.id,
      leadId,
      callId: call.id,
      dedupeKey: `LATE_CALL_UPLOAD:${call.id}`,
    });
  }
  if (lead.stageKey === "NEW") await prisma.lead.update({ where: { id: leadId }, data: { stageKey: "CONTACTED" } });
  await logActivity({
    leadId,
    actorId: user.id,
    type: "CALL_LOGGED",
    message: `${user.name} logged a call${durationSec ? ` (${Math.round(durationSec / 60)} min)` : ""}${recordingPath ? " with recording" : " with transcript"}`,
    data: { callId: call.id, calledAt: calledAt.toISOString(), recordingHash },
  });

  // Transcription + AI analysis run after the response so the agent isn't kept waiting.
  after(() => processCall(call.id));
  return NextResponse.json({ id: call.id });
}
