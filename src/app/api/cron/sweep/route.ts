import { NextResponse } from "next/server";
import { runSweep } from "@/lib/intelligence";

// Call from a scheduler (Vercel Cron, GitHub Actions, cron-job.org) every 15–60 minutes:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/sweep
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runSweep());
}
