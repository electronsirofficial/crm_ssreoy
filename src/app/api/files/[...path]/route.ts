import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readStored } from "@/lib/storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm", aac: "audio/aac", amr: "audio/amr", mp4: "audio/mp4" };

// Evidence files are private: admins see everything; agents only their own uploads.
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rel = (await params).path.join("/");

  if (user.role !== "ADMIN") {
    const owned =
      (await prisma.fieldVisit.count({ where: { agentId: user.id, OR: [{ photoPath: rel }, { checkOutPhotoPath: rel }] } })) +
      (await prisma.call.count({ where: { agentId: user.id, recordingPath: rel } }));
    if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const buf = await readStored(rel);
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
