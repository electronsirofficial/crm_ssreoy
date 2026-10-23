import sharp from "sharp";

/** 64-bit difference hash: robust to re-compression/resizing, so re-submitted old photos are caught. */
export async function dHash(buf: Buffer) {
  const px = await sharp(buf).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  }
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & BigInt(1));
    x >>= BigInt(1);
  }
  return n;
}

/** Burns server time, coordinates and agent name into the photo so the evidence is self-describing. */
export async function watermark(buf: Buffer, lines: string[]) {
  const base = await sharp(buf).rotate().resize({ width: 1280, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const lineH = 26;
  const boxH = lines.length * lineH + 16;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${height - boxH}" width="${width}" height="${boxH}" fill="black" fill-opacity="0.55"/>
    ${lines
      .map((l, i) => `<text x="12" y="${height - boxH + 28 + i * lineH}" font-family="Arial, sans-serif" font-size="20" fill="white">${esc(l)}</text>`)
      .join("")}
  </svg>`;
  const out = await sharp(base.data).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}
