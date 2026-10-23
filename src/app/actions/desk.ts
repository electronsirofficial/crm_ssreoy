"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Exam } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { registerWalkIn } from "@/lib/leads";
import { isValidPhone } from "@/lib/phone";
import { recordEnrollment } from "@/lib/attribution";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function walkInAction(_: unknown, form: FormData) {
  const user = await requireUser(["RECEPTION", "ADMIN"]);
  if (!str(form, "studentName")) return { error: "Student name is required" };
  if (!isValidPhone(str(form, "phone"))) return { error: "Enter a valid 10-digit mobile number" };
  const res = await registerWalkIn(user, {
    studentName: str(form, "studentName"),
    parentName: str(form, "parentName"),
    phone: str(form, "phone"),
    classLevel: str(form, "classLevel"),
    targetExam: (str(form, "targetExam") || "UNKNOWN") as Exam,
    school: str(form, "school"),
    locality: str(form, "locality"),
    declaredAgentId: str(form, "declaredAgentId") || undefined,
    walkInNotes: str(form, "walkInNotes"),
  });
  revalidatePath("/desk");
  redirect(`/desk?lead=${res.lead.id}&new=${res.created ? 1 : 0}`);
}

export async function enrollAction(_: unknown, form: FormData) {
  const user = await requireUser(["RECEPTION", "ADMIN"]);
  const leadId = str(form, "leadId");
  const course = str(form, "course");
  if (!course) return { error: "Course is required" };
  try {
    await recordEnrollment(user, leadId, course, Number(str(form, "feeAmount")) || null);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/desk");
  redirect(`/desk?lead=${leadId}&enrolled=1`);
}
