// Seeds configuration (stages, AI criteria, questionnaire) and, unless SEED_DEMO=false, demo users and
// leads that walk through scenarios A–E from the requirements.
import { PrismaClient, Prisma, type QuestionType } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { saveFile, sha256 } from "../src/lib/storage";
import { dHash } from "../src/lib/image";

const prisma = new PrismaClient();

const STAGES = [
  ["NEW", "New Lead", "slate"],
  ["CONTACTED", "Contacted", "sky"],
  ["INTERESTED", "Interested", "indigo"],
  ["HOME_VISIT_DONE", "Home Visit Completed", "violet"],
  ["INSTITUTE_VISIT_SCHEDULED", "Institute Visit Scheduled", "amber"],
  ["OFFICE_VISIT_DONE", "Office Visit Completed", "orange"],
  ["FOLLOW_UP_REQUIRED", "Follow-Up Required", "yellow"],
  ["ADMISSION_IN_PROGRESS", "Admission in Progress", "teal"],
  ["ENROLLED", "Enrolled", "green"],
  ["LOST", "Lost", "red"],
] as const;

const CRITERIA = [
  ["introduction", "Introduced institute & courses", "Agent clearly introduced themselves, the institute, and explained the relevant JEE/NEET courses.", 15],
  ["needs_discovery", "Understood student's needs", "Agent asked about the student's class, target exam, current performance and goals.", 20],
  ["communication", "Communication quality", "Polite, clear, patient; listened and answered questions accurately without pressure or false promises.", 15],
  ["invitation", "Invited to visit institute", "Agent explicitly invited the family to visit the institute / attend a demo or counselling session.", 20],
  ["prospect_interest", "Genuine prospect interest", "The student or parent showed real interest (asked questions, discussed fees/timings, agreed to next step).", 15],
  ["next_step", "Clear next step", "Call ended with a concrete follow-up: date/time of visit or callback agreed.", 15],
] as const;

type Q = { key: string; text: string; type: QuestionType; options?: string[]; required?: boolean; semantic?: string };
const QUESTIONS: Q[] = [
  { key: "present_people", text: "Who was present at the student's home during the visit?", type: "MULTI", options: ["Student", "Father", "Mother", "Guardian", "Siblings", "Other relatives"], semantic: "PRESENT" },
  { key: "spoke_with", text: "Did you speak directly with the student, the parents, or both?", type: "SINGLE", options: ["Student only", "Parents only", "Both student and parents"], semantic: "MET_WITH" },
  { key: "decision_maker", text: "Who is the primary decision-maker for coaching enrollment?", type: "SINGLE", options: ["Father", "Mother", "Both parents", "Student", "Guardian / other"], semantic: "DECISION_MAKER" },
  { key: "academic_performance", text: "What is the student's current academic performance?", type: "SINGLE", options: ["Excellent (90%+)", "Good (75–90%)", "Average (60–75%)", "Below average (<60%)", "Not disclosed"] },
  { key: "current_class", text: "Which class is the student currently studying in?", type: "DROPDOWN", options: ["Class 8", "Class 9", "Class 10", "Class 11", "Class 12", "12th pass (dropper)"], semantic: "CLASS" },
  { key: "target_exam", text: "Which examination is the student preparing for?", type: "SINGLE", options: ["IIT-JEE", "NEET", "Foundation / Olympiad", "Other", "Undecided"], semantic: "EXAM" },
  { key: "parent_background", text: "Parents' educational / professional background", type: "MULTI", options: ["Doctor", "Engineer", "Teacher / academic", "Government service", "Business", "Private job", "Farmer", "Other"], required: false },
  { key: "concerns", text: "Primary educational concerns of the student and parents", type: "MULTI", options: ["Fees / affordability", "Distance / commute", "Batch size", "Faculty quality", "Results / track record", "Clash with school timings", "Hostel / safety", "Online vs offline"] },
  { key: "knows_students", text: "Does the family know any of our current or former students?", type: "SINGLE", options: ["Yes – current student", "Yes – former student", "Both", "No"] },
  { key: "known_students_details", text: "If yes, who are they and how are they related to the family?", type: "TEXT", required: false },
  { key: "interest_level", text: "How interested are the student and parents in joining?", type: "SINGLE", options: ["Very high – ready to join", "Interested – evaluating", "Lukewarm", "Not interested"], semantic: "INTEREST" },
  { key: "objections", text: "What objections or concerns did the family raise?", type: "MULTI", options: ["Fees too high", "Already enrolled elsewhere", "Prefers online / self-study", "Too far", "Wants to compare institutes", "Student not ready", "None"] },
  { key: "explained", text: "What did you explain to the family?", type: "MULTI", options: ["Courses", "Fee structure", "Scholarships / discounts", "Batch timings", "Faculty", "Past results", "Demo class"] },
  { key: "final_decider", text: "Who will make the final enrollment decision?", type: "SINGLE", options: ["Father", "Mother", "Both parents", "Student", "Guardian / other"] },
  { key: "timeline", text: "Expected enrollment timeline", type: "SINGLE", options: ["Within a week", "Within a month", "1–3 months", "After board exams", "Undecided"] },
  { key: "another_meeting", text: "Is another meeting or discussion required?", type: "BOOLEAN" },
  { key: "followup_action", text: "What follow-up action should be taken?", type: "SINGLE", options: ["Call back", "Second home visit", "Invite for demo class", "Invite for counselling at institute", "Send fee details on WhatsApp", "No further action"] },
  { key: "followup_date", text: "When should the next follow-up happen?", type: "DATE", required: false },
];

const days = (n: number) => new Date(Date.now() - n * 864e5);
const mins = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

/** 1-second quiet tone WAV, unique per call so recording-reuse detection doesn't fire on demo data. */
function demoWav(seed: string) {
  const rate = 8000;
  const data = Buffer.alloc(rate * 2);
  const freq = 200 + (seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 400);
  for (let i = 0; i < rate; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 800), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function demoPhoto(label: string, hue: number) {
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="600" fill="hsl(${hue},45%,60%)"/>
    <rect x="${120 + (hue % 200)}" y="180" width="300" height="240" fill="hsl(${(hue + 40) % 360},40%,35%)"/>
    <polygon points="${100 + (hue % 200)},190 ${270 + (hue % 200)},80 ${440 + (hue % 200)},190" fill="hsl(${(hue + 90) % 360},50%,30%)"/>
    <text x="30" y="560" font-size="34" font-family="Arial" fill="white">DEMO · ${label}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  return { path: await saveFile("photos", buf, "jpg"), hash: sha256(buf), dhash: await dHash(buf) };
}

async function main() {
  for (const [i, [key, label, color]] of STAGES.entries()) {
    await prisma.leadStage.upsert({ where: { key }, create: { key, label, color, order: i, isTerminal: key === "ENROLLED" || key === "LOST" }, update: {} });
  }
  for (const [i, [key, label, description, weight]] of CRITERIA.entries()) {
    await prisma.evaluationCriterion.upsert({ where: { key }, create: { key, label, description, weight, order: i }, update: {} });
  }
  for (const [i, q] of QUESTIONS.entries()) {
    await prisma.questionnaireQuestion.upsert({
      where: { key: q.key },
      create: { key: q.key, text: q.text, type: q.type, options: q.options ?? Prisma.JsonNull, required: q.required ?? true, order: i, semantic: q.semantic },
      update: {},
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@institute.test";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: { name: "Institute Admin", email: adminEmail, role: "ADMIN", passwordHash: await bcrypt.hash(adminPassword, 10) },
    update: {},
  });
  console.log(`Admin: ${adminEmail} / ${adminPassword}`);

  if (process.env.SEED_DEMO === "false") return;
  if (await prisma.lead.count()) {
    console.log("Leads already exist — skipping demo data.");
    return;
  }

  const pw = await bcrypt.hash("Demo@12345", 10);
  const mk = (name: string, email: string, role: "AGENT" | "RECEPTION") =>
    prisma.user.create({ data: { name, email, role, passwordHash: pw, phone: null } });
  const ravi = await mk("Ravi Kumar", "ravi@institute.test", "AGENT");
  const priya = await mk("Priya Sharma", "priya@institute.test", "AGENT");
  const arjun = await mk("Arjun Singh", "arjun@institute.test", "AGENT");
  const desk = await mk("Front Desk", "desk@institute.test", "RECEPTION");
  console.log("Demo users (password Demo@12345): ravi@, priya@, arjun@ (agents), desk@ (reception) — all @institute.test");

  // Keep these imports lazy so the config-only seed has no dependency on app code paths.
  const { logActivity } = await import("../src/lib/audit");
  const { verifyVisit } = await import("../src/lib/visits");
  const { recordEnrollment } = await import("../src/lib/attribution");

  const lead = async (data: Prisma.LeadUncheckedCreateInput) => {
    const l = await prisma.lead.create({ data });
    if (data.createdById && data.source !== "WALK_IN")
      await prisma.leadClaim.create({ data: { leadId: l.id, agentId: data.createdById, kind: "CREATED", createdAt: data.createdAt as Date } });
    await logActivity({ leadId: l.id, actorId: data.createdById ?? null, type: data.source === "WALK_IN" ? "WALK_IN" : "LEAD_CREATED", message: `Lead created (${data.source}) [demo]` });
    return l;
  };

  const goodEval = (scores: number[]) =>
    CRITERIA.map(([key, label, , weight], i) => ({ key, label, weight, score: scores[i], comment: "[demo] assessed from transcript" }));
  const weighted = (scores: number[]) =>
    Math.round((CRITERIA.reduce((a, c, i) => a + c[3] * scores[i], 0) / CRITERIA.reduce((a, c) => a + c[3], 0)) * 10);

  const call = async (leadId: string, agentId: string, at: Date, dur: number, scores: number[], extra: Partial<Prisma.CallUncheckedCreateInput> = {}) => {
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const rec = demoWav(`${leadId}:${at.toISOString()}`);
    extra = { recordingPath: await saveFile("recordings", rec, "wav"), recordingHash: sha256(rec), recordingMime: "audio/wav", ...extra };
    const c = await prisma.call.create({
      data: {
        leadId,
        agentId,
        phoneNumber: l.phone,
        calledAt: at,
        createdAt: mins(at, 20),
        durationSec: dur,
        consentConfirmed: true,
        reportedOutcome: "Invited to institute",
        reportedInterest: "High",
        transcript: "[demo transcript] Agent: Namaste, I'm calling from the institute about JEE/NEET coaching... Parent: Haan ji, tell me about the batches...",
        transcriptStatus: "DONE",
        summary: "[demo] Agent introduced the institute, discussed the student's class and target exam, and invited the family to visit for counselling. Parent asked about fees and batch timings.",
        qualityScore: weighted(scores),
        conversionScore: 65,
        evaluation: goodEval(scores),
        discrepancies: [],
        aiInsights: { meaningfulConversation: weighted(scores) > 30, invitedToVisit: scores[3] >= 6, visitCommitted: scores[5] >= 7, spokeWith: "PARENT", prospectInterest: "HIGH", nextAction: "Confirm visit date", suggestedFollowUpDays: 2, integrityConcerns: [] },
        analysisStatus: "DONE",
        analyzedAt: mins(at, 25),
        ...extra,
      },
    });
    await logActivity({ leadId, actorId: agentId, type: "CALL_LOGGED", message: `Call recorded (${dur}s) [demo]`, data: { callId: c.id } });
    return c;
  };

  let hue = 10;
  const visit = async (leadId: string, agentId: string, at: Date, durationMin: number, lat: number, lng: number, answers: Record<string, unknown> | null, fillSeconds = 240, photo?: { path: string; hash: string; dhash: string }) => {
    const p = photo ?? (await demoPhoto(`visit ${hue}`, (hue += 47)));
    const v = await prisma.fieldVisit.create({
      data: {
        leadId, agentId, status: "COMPLETED",
        checkInAt: at, checkInClientAt: at, checkInLat: lat, checkInLng: lng, checkInAccuracy: 18,
        photoPath: p.path, photoHash: p.hash, photoDHash: p.dhash,
        checkOutAt: mins(at, durationMin), checkOutClientAt: mins(at, durationMin), checkOutLat: lat + 0.0001, checkOutLng: lng + 0.0001, checkOutAccuracy: 20,
        durationMin, checkInOutDriftM: 15,
        questionnaire: answers ? { create: { answers: answers as Prisma.InputJsonValue, startedAt: mins(at, durationMin + 1), submittedAt: mins(at, durationMin + 1 + fillSeconds / 60), fillSeconds, completeness: 100 } } : undefined,
      },
    });
    await logActivity({ leadId, actorId: agentId, type: "VISIT_CHECK_OUT", message: `Home visit, ${durationMin} min [demo]`, data: { visitId: v.id } });
    await verifyVisit(v.id);
    return { v, p };
  };

  const answers = (interest: string) => ({
    present_people: ["Student", "Father", "Mother"], spoke_with: "Both student and parents", decision_maker: "Both parents",
    academic_performance: "Good (75–90%)", current_class: "Class 11", target_exam: "IIT-JEE", parent_background: ["Engineer"],
    concerns: ["Fees / affordability", "Batch size"], knows_students: "No", interest_level: interest, objections: ["Wants to compare institutes"],
    explained: ["Courses", "Fee structure", "Past results"], final_decider: "Father", timeline: "Within a month", another_meeting: true,
    followup_action: "Invite for counselling at institute", followup_date: days(-3).toISOString().slice(0, 10),
  });

  // Scenario A — Ravi's recorded call brings the family in.
  const a = await lead({ studentName: "Aarav Mehta", parentName: "Sunil Mehta", phone: "9812300001", classLevel: "Class 11", targetExam: "JEE", locality: "Civil Lines", source: "OUTBOUND_CALL", stageKey: "CONTACTED", createdById: ravi.id, assignedToId: ravi.id, createdAt: days(12) });
  await call(a.id, ravi.id, days(11), 410, [8, 8, 7, 9, 8, 8]);
  await prisma.lead.update({ where: { id: a.id }, data: { walkInAt: days(8), stageKey: "OFFICE_VISIT_DONE" } });
  await recordEnrollment(desk, a.id, "JEE 2-Year Classroom", 145000);

  // Scenario B — Priya's verified home visit + questionnaire.
  const b = await lead({ studentName: "Ananya Iyer", parentName: "Lakshmi Iyer", phone: "9812300002", classLevel: "Class 11", targetExam: "NEET", locality: "Gandhi Nagar", source: "FIELD_VISIT", stageKey: "NEW", createdById: priya.id, assignedToId: priya.id, createdAt: days(15) });
  await visit(b.id, priya.id, days(14), 42, 26.8467, 80.9462, answers("Very high – ready to join"));
  await prisma.lead.update({ where: { id: b.id }, data: { walkInAt: days(6) } });
  await recordEnrollment(desk, b.id, "NEET 2-Year Classroom", 155000);

  // Scenario C — direct walk-in, then Arjun tries to claim the family.
  const c = await lead({ studentName: "Kabir Verma", parentName: "Neha Verma", phone: "9812300003", classLevel: "Class 12", targetExam: "JEE", source: "WALK_IN", stageKey: "OFFICE_VISIT_DONE", createdById: desk.id, walkInAt: days(5), createdAt: days(5) });
  await recordEnrollment(desk, c.id, "JEE 1-Year Crash", 90000);
  await prisma.leadClaim.create({ data: { leadId: c.id, agentId: arjun.id, kind: "DUPLICATE_ATTEMPT" } });
  await prisma.fraudFlag.create({ data: { type: "CLAIM_ON_WALK_IN", severity: "HIGH", message: "Arjun Singh tried to register Kabir Verma after the family walked in", agentId: arjun.id, leadId: c.id, dedupeKey: `CLAIM_ON_WALK_IN:${c.id}:${arjun.id}` } });

  // Scenario D — Arjun's 6-minute visit with a rushed questionnaire; family later walks in on its own.
  const dLead = await lead({ studentName: "Ishita Rao", parentName: "Mohan Rao", phone: "9812300004", classLevel: "Class 10", targetExam: "NEET", source: "FIELD_VISIT", stageKey: "NEW", createdById: arjun.id, assignedToId: arjun.id, createdAt: days(10) });
  await visit(dLead.id, arjun.id, days(9), 6, 26.8601, 80.9310, answers("Lukewarm"), 25);
  await prisma.lead.update({ where: { id: dLead.id }, data: { walkInAt: days(3) } });
  await recordEnrollment(desk, dLead.id, "NEET Foundation", 60000);

  // Scenario E — Ravi called, lead was later reassigned and Priya made a verified visit: contested.
  const e = await lead({ studentName: "Rohan Gupta", parentName: "Anita Gupta", phone: "9812300005", classLevel: "Class 11", targetExam: "JEE", source: "OUTBOUND_CALL", stageKey: "CONTACTED", createdById: ravi.id, assignedToId: priya.id, createdAt: days(20) });
  await call(e.id, ravi.id, days(19), 300, [7, 7, 7, 8, 7, 7]);
  await visit(e.id, priya.id, days(9), 35, 26.8520, 80.9500, answers("Interested – evaluating"));
  await prisma.lead.update({ where: { id: e.id }, data: { walkInAt: days(2) } });
  await recordEnrollment(desk, e.id, "JEE 2-Year Classroom", 145000);

  // Suspicious activity — Arjun reuses a photo for another family.
  const f1 = await lead({ studentName: "Meera Joshi", parentName: "Rajesh Joshi", phone: "9812300006", classLevel: "Class 9", targetExam: "FOUNDATION", source: "FIELD_VISIT", stageKey: "HOME_VISIT_DONE", createdById: arjun.id, assignedToId: arjun.id, createdAt: days(4) });
  const first = await visit(f1.id, arjun.id, days(4), 22, 26.8700, 80.9100, answers("Interested – evaluating"));
  const f2 = await lead({ studentName: "Dev Malhotra", parentName: "Pooja Malhotra", phone: "9812300007", classLevel: "Class 9", targetExam: "FOUNDATION", source: "FIELD_VISIT", stageKey: "HOME_VISIT_DONE", createdById: arjun.id, assignedToId: arjun.id, createdAt: days(2) });
  await visit(f2.id, arjun.id, days(2), 18, 26.8701, 80.9101, answers("Interested – evaluating"), 200, first.p);

  // Open pipeline with follow-ups (some overdue) and a neglected hot lead.
  const open = [
    { studentName: "Sneha Patel", phone: "9812300008", agent: ravi, exam: "NEET" as const, conv: 82, due: -1 },
    { studentName: "Aditya Nair", phone: "9812300009", agent: ravi, exam: "JEE" as const, conv: 45, due: 2 },
    { studentName: "Tanya Bose", phone: "9812300010", agent: priya, exam: "NEET" as const, conv: 74, due: -2 },
    { studentName: "Yash Agarwal", phone: "9812300011", agent: priya, exam: "JEE" as const, conv: 30, due: 1 },
    { studentName: "Riya Kapoor", phone: "9812300012", agent: arjun, exam: "JEE" as const, conv: 88, due: null },
  ];
  for (const o of open) {
    const l = await lead({ studentName: o.studentName, parentName: null, phone: o.phone, classLevel: "Class 11", targetExam: o.exam, source: "OUTBOUND_CALL", stageKey: "INTERESTED", createdById: o.agent.id, assignedToId: o.agent.id, createdAt: days(7), aiConversion: o.conv, aiPriority: o.conv, aiNextAction: "Invite the family for a counselling session this week." });
    await call(l.id, o.agent.id, days(6), 240, [7, 6, 7, 7, 6, 6]);
    if (o.due !== null) {
      const dueAt = days(-o.due);
      await prisma.followUp.create({ data: { leadId: l.id, agentId: o.agent.id, dueAt, type: "CALL", notes: "Discuss fee structure and batch timings" } });
      await prisma.lead.update({ where: { id: l.id }, data: { nextFollowUpAt: dueAt } });
    }
  }
  console.log(`Seeded demo data. Admin user id ${admin.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
