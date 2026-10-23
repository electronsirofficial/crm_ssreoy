import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { checkOut, VisitError } from "@/lib/visits";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser(["AGENT"]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { lat?: number; lng?: number; accuracy?: number; clientAt?: number };
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "A GPS location is required to check out" }, { status: 400 });
  try {
    const result = await checkOut(user, (await params).id, {
      lat,
      lng,
      accuracy: Number(body.accuracy) || null,
      clientAt: body.clientAt ? new Date(body.clientAt) : null,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof VisitError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
