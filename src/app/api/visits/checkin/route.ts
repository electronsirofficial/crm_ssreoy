import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { leadForUser } from "@/lib/access";
import { checkIn, VisitError } from "@/lib/visits";

export async function POST(req: Request) {
  const user = await apiUser(["AGENT"]);
  if (!user) return NextResponse.json({ error: "Only agents can record visits" }, { status: 401 });
  const form = await req.formData();
  const leadId = String(form.get("leadId") ?? "");
  if (!(await leadForUser(user, leadId))) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const photo = form.get("photo");
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  if (!(photo instanceof File) || !photo.size) return NextResponse.json({ error: "A live photo is required" }, { status: 400 });
  if (photo.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Photo too large" }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0))
    return NextResponse.json({ error: "A GPS location is required" }, { status: 400 });

  const clientAt = Number(form.get("clientAt"));
  try {
    const visit = await checkIn(
      user,
      leadId,
      Buffer.from(await photo.arrayBuffer()),
      { lat, lng, accuracy: Number(form.get("accuracy")) || null, clientAt: clientAt ? new Date(clientAt) : null },
      { userAgent: req.headers.get("user-agent"), ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null },
    );
    return NextResponse.json({ id: visit.id });
  } catch (e) {
    if (e instanceof VisitError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
