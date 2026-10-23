import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Local disk storage under ./storage (outside /public, so files are only served through the
// authenticated /api/files route). Swap for S3/R2 in production.
const ROOT = path.resolve(process.env.STORAGE_DIR ?? "storage");

export function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function saveFile(folder: "photos" | "recordings", buf: Buffer, ext: string) {
  const dir = path.join(ROOT, folder);
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
  await writeFile(path.join(dir, name), buf);
  return `${folder}/${name}`;
}

export function resolveStored(rel: string) {
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid path");
  return full;
}

export async function readStored(rel: string) {
  return readFile(resolveStored(rel));
}
