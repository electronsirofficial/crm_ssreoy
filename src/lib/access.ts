import type { User } from "@prisma/client";
import { prisma } from "./db";

/** Agents may only work on leads assigned to them; admins may access any lead. */
export async function leadForUser(user: User, leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return null;
  if (user.role === "ADMIN") return lead;
  if (user.role === "AGENT" && lead.assignedToId === user.id) return lead;
  return null;
}
