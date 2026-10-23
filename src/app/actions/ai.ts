"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { leadForUser } from "@/lib/access";
import { refreshLeadInsight, runAgentInsight } from "@/lib/intelligence";
import { processCall } from "@/lib/calls";
import { prisma } from "@/lib/db";

export async function refreshInsightAction(form: FormData) {
  const user = await requireUser(["AGENT", "ADMIN"]);
  const leadId = String(form.get("leadId"));
  if (!(await leadForUser(user, leadId))) throw new Error("Lead not found");
  await refreshLeadInsight(leadId);
  revalidatePath(`/agent/leads/${leadId}`);
  revalidatePath(`/admin/leads/${leadId}`);
}

export async function agentInsightAction(form: FormData) {
  await requireUser(["ADMIN"]);
  const agentId = String(form.get("agentId"));
  await runAgentInsight(agentId);
  revalidatePath(`/admin/agents/${agentId}`);
}

export async function reprocessCallAction(form: FormData) {
  await requireUser(["ADMIN"]);
  const callId = String(form.get("callId"));
  const transcript = String(form.get("transcript") ?? "").trim();
  if (transcript) {
    await prisma.call.update({ where: { id: callId }, data: { transcript, transcriptStatus: "DONE", transcriptError: null } });
  }
  await prisma.call.update({ where: { id: callId }, data: { analysisStatus: "PENDING", analysisError: null } });
  after(() => processCall(callId));
  revalidatePath(`/admin/calls/${callId}`);
}
