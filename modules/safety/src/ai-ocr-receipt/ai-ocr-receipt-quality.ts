// ai-ocr-receipt-quality.ts — Receipt / Expense mandate §24–§26 and §159 (Oct 27 2026), dependency-free and PURE:
//
//   §25 image quality analysis BEFORE OCR — cheap, deterministic heuristics over the decoded grey image (the same decoder
//       the perceptual hash uses, ai-ocr-receipt-phash.ts): low resolution, too dark, washed out, low contrast / likely blur,
//       a tiny file, and "probably more than one receipt" (two wide dark gaps splitting the paper). A flag is advice to the
//       person ("Receipt may be difficult to read — Retake / Process anyway", §26); nothing here fails an upload.
//   §24/§159 derived copies — the ORIGINAL is never touched (§19). A grey PNG thumbnail (longest side ≤ 320 px) for lists, and
//       a grey PNG review / OCR copy (longest side ≤ 1600 px) when the original is a large photo, so a 20 MB phone picture is
//       not re-downloaded on every scroll or re-sent to a provider. Area-averaged downscale; 8-bit greyscale PNG via zlib.
//   A PDF, HEIC, WebP or a progressive JPEG the decoder does not read gets no flags and no derivatives (honest: nothing is
//   invented about an image nobody looked at) — `decoded: false` says so.
import { deflateSync } from 'node:zlib';
import { decodeGrey, type GreyImage } from './ai-ocr-receipt-phash';

export type QualityFlag = 'undecodable' | 'low_resolution' | 'too_dark' | 'washed_out' | 'low_contrast' | 'likely_blurry' | 'tiny_file' | 'multiple_receipts';
export interface QualityReport { decoded: boolean; width: number | null; height: number | null; flags: QualityFlag[]; meanLuminance: number | null; contrast: number | null; sharpness: number | null; difficult: boolean }

export const QUALITY_THRESHOLDS = {
  minPixels: 300_000,         // ~550 × 550: below this a thermal receipt's 8 pt print is unreadable
  tinyFileBytes: 12_000,      // a 12 KB "photo" is a screenshot of a thumbnail, not a receipt
  darkMean: 60, washedMean: 238, lowContrastStd: 14, blurSharpness: 2.0,
} as const;

/** Real pixel dimensions from the file header (PNG IHDR / JPEG SOFn / GIF / WebP VP8X) — the client's numbers are never trusted. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { p += 2; continue; }
      const len = b.readUInt16BE(p + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7) };
      if (m === 0xda) break;
      p += 2 + len;
    }
    return null;
  }
  if (b.length >= 10 && b.toString('latin1', 0, 4) === 'GIF8') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' && b.toString('latin1', 12, 16) === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

/** §25: the flags, and the three measurements behind them. Never throws. */
export function analyzeReceiptImage(bytes: Uint8Array, mime: string): QualityReport {
  const none: QualityReport = { decoded: false, width: null, height: null, flags: [], meanLuminance: null, contrast: null, sharpness: null, difficult: false };
  if (!/^image\//.test(mime)) return none;
  let img: GreyImage | null = null;
  try { img = decodeGrey(bytes); } catch { img = null; }
  const dims = imageDimensions(bytes);
  if (!img) return { ...none, width: dims?.width ?? null, height: dims?.height ?? null, flags: dims && dims.width * dims.height < QUALITY_THRESHOLDS.minPixels ? ['low_resolution'] : [] , difficult: !!dims && dims.width * dims.height < QUALITY_THRESHOLDS.minPixels };
  const width = dims?.width ?? img.w, height = dims?.height ?? img.h;
  const flags: QualityFlag[] = [];
  if (width * height < QUALITY_THRESHOLDS.minPixels) flags.push('low_resolution');
  // a JPEG only: a lossless PNG of flat paper is legitimately small, a 12 KB JPEG "photo" is a screenshot of a thumbnail
  if (/jpe?g$/.test(mime) && bytes.length < QUALITY_THRESHOLDS.tinyFileBytes && width * height >= QUALITY_THRESHOLDS.minPixels) flags.push('tiny_file');
  const n = img.px.length;
  let sum = 0; for (let i = 0; i < n; i++) sum += img.px[i];
  const mean = sum / n;
  let varSum = 0; for (let i = 0; i < n; i++) { const d = img.px[i] - mean; varSum += d * d; }
  const std = Math.sqrt(varSum / n);
  // sharpness: mean absolute Laplacian, normalised by contrast — a crisp print has strong edges relative to its spread; a
  // blurred or out-of-focus one does not (on a JPEG the decoder's 8× DC image still carries the block-level edges)
  let lap = 0, cnt = 0;
  for (let y = 1; y < img.h - 1; y++) for (let x = 1; x < img.w - 1; x++) {
    const i = y * img.w + x;
    lap += Math.abs(4 * img.px[i] - img.px[i - 1] - img.px[i + 1] - img.px[i - img.w] - img.px[i + img.w]); cnt++;
  }
  const sharpness = cnt && std > 0 ? (lap / cnt) / std * 10 : 0;
  if (mean < QUALITY_THRESHOLDS.darkMean) flags.push('too_dark');
  if (mean > QUALITY_THRESHOLDS.washedMean) flags.push('washed_out');
  if (std < QUALITY_THRESHOLDS.lowContrastStd) flags.push('low_contrast');
  else if (sharpness < QUALITY_THRESHOLDS.blurSharpness && cnt > 64) flags.push('likely_blurry');
  if (looksLikeSeveralReceipts(img)) flags.push('multiple_receipts');
  return { decoded: true, width, height, flags, meanLuminance: Math.round(mean), contrast: Math.round(std * 10) / 10, sharpness: Math.round(sharpness * 100) / 100, difficult: flags.length > 0 };
}

/** Two or more bright paper columns separated by a dark gap wider than 6 % of the image — side-by-side receipts on a desk. */
function looksLikeSeveralReceipts(img: GreyImage): boolean {
  if (img.w < 24 || img.h < 8) return false;
  const col = new Float64Array(img.w);
  for (let x = 0; x < img.w; x++) { let s = 0; for (let y = 0; y < img.h; y++) s += img.px[y * img.w + x]; col[x] = s / img.h; }
  const bright = Array.from(col, (v) => v > 150);
  let runs = 0, inRun = false, gap = 0, maxGap = 0, started = false;
  for (let x = 0; x < img.w; x++) {
    if (bright[x]) { if (!inRun) { runs++; inRun = true; if (started && gap > maxGap) maxGap = gap; } gap = 0; started = true; }
    else { inRun = false; if (started) gap++; }
  }
  return runs >= 2 && maxGap >= Math.max(2, Math.floor(img.w * 0.06));
}

// ── §24 / §159 derivatives ─────────────────────────────────────────────────────────────────────────────────────────────
export interface Derivative { kind: 'thumbnail' | 'processed'; png: Uint8Array; width: number; height: number }

/** The derived copies of an image: a thumbnail always (when decodable), a review / OCR copy only for a large original. */
export function makeDerivatives(bytes: Uint8Array, mime: string, opts: { thumbMax?: number; processedMax?: number; processedWhenBytesOver?: number } = {}): Derivative[] {
  if (!/^image\//.test(mime)) return [];
  let img: GreyImage | null = null;
  try { img = decodeGrey(bytes); } catch { img = null; }
  if (!img || img.w < 2 || img.h < 2) return [];
  const out: Derivative[] = [];
  const thumb = resizeGrey(img, opts.thumbMax ?? 320);
  out.push({ kind: 'thumbnail', png: encodeGreyPng(thumb), width: thumb.w, height: thumb.h });
  if (bytes.length > (opts.processedWhenBytesOver ?? 2_000_000)) {
    const big = resizeGrey(img, opts.processedMax ?? 1600);
    out.push({ kind: 'processed', png: encodeGreyPng(big), width: big.w, height: big.h });
  }
  return out;
}

/** Area-averaged downscale so the longest side is ≤ max (never upscaled). */
export function resizeGrey(img: GreyImage, max: number): GreyImage {
  const scale = Math.min(1, max / Math.max(img.w, img.h));
  const w = Math.max(1, Math.round(img.w * scale)), h = Math.max(1, Math.round(img.h * scale));
  if (w === img.w && h === img.h) return img;
  const px = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = (y * img.h) / h, y1 = ((y + 1) * img.h) / h;
    for (let x = 0; x < w; x++) {
      const x0 = (x * img.w) / w, x1 = ((x + 1) * img.w) / w;
      let sum = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0); if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0); if (wx <= 0) continue;
          sum += img.px[yy * img.w + xx] * wx * wy; wsum += wx * wy;
        }
      }
      px[y * w + x] = wsum ? sum / wsum : 0;
    }
  }
  return { w, h, px };
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };

/** An 8-bit greyscale PNG (filter 0 on every row). */
export function encodeGreyPng(img: GreyImage): Uint8Array {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((img.w + 1) * img.h);
  for (let y = 0; y < img.h; y++) { raw[y * (img.w + 1)] = 0; for (let x = 0; x < img.w; x++) raw[y * (img.w + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(img.px[y * img.w + x]))); }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
