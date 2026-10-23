import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, homeFor } from "@/lib/session";

const ROLE_PREFIX: Record<string, Array<"ADMIN" | "AGENT" | "RECEPTION">> = {
  "/admin": ["ADMIN"],
  "/agent": ["AGENT", "ADMIN"],
  "/desk": ["RECEPTION", "ADMIN"],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL(homeFor(session.role), req.url));
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname === "/") return NextResponse.redirect(new URL(homeFor(session.role), req.url));

  for (const [prefix, roles] of Object.entries(ROLE_PREFIX)) {
    if (pathname.startsWith(prefix) && !roles.includes(session.role)) {
      return NextResponse.redirect(new URL(homeFor(session.role), req.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron).*)"],
};
