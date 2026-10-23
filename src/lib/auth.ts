import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession, homeFor, type SessionPayload } from "./session";

export type Role = SessionPayload["role"];

export async function getSession() {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/** Loads the signed-in user for a page/action, redirecting if missing or not allowed. */
export async function requireUser(roles?: Role[]) {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!user || !user.active) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** For route handlers: returns the user or null instead of redirecting. */
export async function apiUser(roles?: Role[]) {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.uid } });
  if (!user || !user.active) return null;
  if (roles && !roles.includes(user.role)) return null;
  return user;
}
