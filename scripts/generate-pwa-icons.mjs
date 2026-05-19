import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import zlib from "zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "client", "public", "icons");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function pngRgba(size, rgbaFn) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1) + 1;
    raw[row - 1] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = rgbaFn(x, y, size);
      const i = row + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  return pngRgba(size, (x, y, s) => {
    const cx = s / 2;
    const cy = s / 2;
    const r = s * 0.46;
    const dx = x - cx + 0.5;
    const dy = y - cy + 0.5;
    const inRound = dx * dx + dy * dy <= r * r;
    if (!inRound) return [0, 0, 0, 0];
    const t = Math.hypot(dx, dy) / r;
    const bg = [15, 42, 68, 255];
    const accent = [56, 189, 248, 255];
    const mix = 1 - t * 0.35;
    const letter =
      x > s * 0.28 && x < s * 0.72 && y > s * 0.22 && y < s * 0.78 && Math.abs(x - cx) < s * 0.14;
    if (letter) return accent;
    return [Math.round(bg[0] * mix), Math.round(bg[1] * mix), Math.round(bg[2] * mix), 255];
  });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-192.png"), drawIcon(192));
fs.writeFileSync(path.join(outDir, "icon-512.png"), drawIcon(512));
console.log("PWA icons written to", outDir);
