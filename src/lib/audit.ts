import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

const GENESIS = "0".repeat(64);

// Postgres jsonb does not preserve key order, so hash a canonical form with sorted keys.
function canonical(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function hashRow(prevHash: string, r: { leadId: string | null; actorId: string | null; type: string; message: string; data: unknown; createdAt: Date }) {
  return createHash("sha256")
    .update(canonical([prevHash, r.leadId, r.actorId, r.type, r.message, r.data ?? null, r.createdAt.toISOString()]))
    .digest("hex");
}

/**
 * Appends to the hash-chained audit log. A transaction-scoped advisory lock serializes writers so
 * the chain stays linear even under concurrent requests.
 */
export async function logActivity(entry: {
  leadId?: string | null;
  actorId?: string | null;
  type: string;
  message: string;
  data?: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(814402)`;
    const last = await tx.activity.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS;
    const createdAt = new Date();
    const row = {
      leadId: entry.leadId ?? null,
      actorId: entry.actorId ?? null,
      type: entry.type,
      message: entry.message,
      data: entry.data ?? null,
      createdAt,
    };
    return tx.activity.create({
      data: {
        leadId: row.leadId,
        actorId: row.actorId,
        type: row.type,
        message: row.message,
        data: entry.data ?? Prisma.JsonNull,
        createdAt,
        prevHash,
        hash: hashRow(prevHash, row),
      },
    });
  });
}

/** Re-computes the whole chain; returns the first broken sequence number, if any. */
export async function verifyAuditChain() {
  const rows = await prisma.activity.findMany({ orderBy: { seq: "asc" } });
  let prev = GENESIS;
  for (const r of rows) {
    const expected = hashRow(prev, { leadId: r.leadId, actorId: r.actorId, type: r.type, message: r.message, data: r.data, createdAt: r.createdAt });
    if (r.prevHash !== prev || r.hash !== expected) {
      return { ok: false as const, count: rows.length, brokenAtSeq: r.seq };
    }
    prev = r.hash;
  }
  return { ok: true as const, count: rows.length };
}
