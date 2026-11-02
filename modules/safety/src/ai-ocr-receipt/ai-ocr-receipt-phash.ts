// ai-ocr-receipt-phash.ts — Remaining Production §31 (Oct 27 2026): the PERCEPTUAL hash of an uploaded receipt image, so a
// re-photographed / re-saved / re-compressed copy of the same receipt is caught as a near-duplicate (ai-ocr-receipt-dedup.ts
// compares it by Hamming distance: ≤ 6 likely, ≤ 12 possible). Before this the column was always NULL.
//
// Dependency-free on purpose (no native image library in the API image; pngjs is a dev dependency only):
//   • PNG  — chunks + node:zlib inflate + the five scanline filters; grey / grey+alpha / RGB / RGBA / palette, 1–16 bit.
//            Adam7-interlaced PNGs answer null (rare for receipts; honest rather than wrong).
//   • JPEG — baseline / extended-sequential Huffman only, and only the DC coefficient of each 8×8 luma block is kept: the
//            DC term IS the block's mean brightness, so the decoder yields the image already downscaled 8× with no IDCT
//            (DC × the luma quantiser's DC step ÷ 8 + 128 = the block's mean on the 0–255 scale). Progressive / arithmetic / lossless
//            JPEGs answer null.
//   • anything else (PDF, HEIC, WebP) → null; the dedup engine then relies on its other signals (file hash, transaction
//     signature, vendor + total + date), exactly as before.
// The hash is a 64-bit dHash (difference hash) over a 9×8 area-averaged grey image, as 16 hex characters.
import { inflateSync } from 'node:zlib';

/** A grey image: w × h luminance values (any consistent scale). */
export interface GreyImage { w: number; h: number; px: Float64Array }

const MAX_PIXELS = 50_000_000;   // a 7,000 × 7,000 phone photo is 49 MP; anything bigger is refused (null), never decoded

/** The 64-bit dHash of an image's bytes as 16 hex characters, or null when the format is not one this decodes. Never throws. */
export function perceptualHashOf(bytes: Uint8Array): string | null {
  return perceptualHashDetailed(bytes).hash;
}
/** The same, saying WHY there is no hash: 'unsupported' (PDF, HEIC, progressive JPEG …) or 'undecodable: <reason>' (a
 *  truncated / corrupt image — the upload itself is not refused for it; the dedup engine uses its other signals). */
export function perceptualHashDetailed(bytes: Uint8Array): { hash: string | null; reason: string | null } {
  try {
    const img = decodeGrey(bytes);
    const hash = img ? dHash(img) : null;
    return { hash, reason: hash ? null : 'unsupported' };
  } catch (e) { return { hash: null, reason: 'undecodable: ' + String((e as Error)?.message ?? e).slice(0, 120) }; }
}

export function decodeGrey(bytes: Uint8Array): GreyImage | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return decodePngGrey(b);
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return decodeJpegDcGrey(b);
  return null;
}

/** Two cells closer than this (0–255 luminance) count as equal. */
const TIE = 1.5;
/** dHash: 9 × 8 area average, then one bit per horizontal neighbour pair (left brighter than right → 1). */
export function dHash(img: GreyImage): string | null {
  if (img.w < 1 || img.h < 1) return null;
  const W = 9, H = 8;
  const small = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = (y * img.h) / H, y1 = ((y + 1) * img.h) / H;
    for (let x = 0; x < W; x++) {
      const x0 = (x * img.w) / W, x1 = ((x + 1) * img.w) / W;
      small[y * W + x] = areaMean(img, x0, x1, y0, y1);
    }
  }
  let hex = '';
  for (let y = 0; y < H; y++) {
    let nib = 0;
    for (let x = 0; x < 8; x++) {
      // a near-tie (flat paper) is 0: without the tolerance, rounding noise in blank areas flipped bits between a JPEG
      // and a PNG of the same receipt
      nib = (nib << 1) | (small[y * W + x] > small[y * W + x + 1] + TIE ? 1 : 0);
      if (x % 4 === 3) { hex += nib.toString(16); nib = 0; }
    }
  }
  return hex;
}
/** Mean over the real-valued box [x0,x1) × [y0,y1), each source pixel weighted by its overlap (works up- and down-scaling). */
function areaMean(img: GreyImage, x0: number, x1: number, y0: number, y1: number): number {
  let sum = 0, wsum = 0;
  for (let y = Math.floor(y0); y < Math.min(img.h, Math.ceil(y1)); y++) {
    const wy = Math.min(y + 1, y1) - Math.max(y, y0);
    if (wy <= 0) continue;
    for (let x = Math.floor(x0); x < Math.min(img.w, Math.ceil(x1)); x++) {
      const wx = Math.min(x + 1, x1) - Math.max(x, x0);
      if (wx <= 0) continue;
      sum += img.px[y * img.w + x] * wx * wy; wsum += wx * wy;
    }
  }
  return wsum ? sum / wsum : 0;
}

// ───────────────────────────────────────────────── PNG ─────────────────────────────────────────────────
function decodePngGrey(b: Buffer): GreyImage | null {
  let p = 8, w = 0, h = 0, depth = 0, ctype = -1, interlace = 0; let palette: Buffer | null = null; let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8); const data = b.subarray(p + 8, p + 8 + len);
    if (p + 12 + len > b.length) return null;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!w || !h || !channels || interlace !== 0 || ![1, 2, 4, 8, 16].includes(depth) || w * h > MAX_PIXELS || (ctype === 3 && !palette)) return null;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((w * channels * depth) / 8);
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * h + 16 });
  if (raw.length < (stride + 1) * h) return null;
  const out = Buffer.alloc(stride * h); const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); const cur = out.subarray(y * stride, (y + 1) * stride);
    const up = y ? out.subarray((y - 1) * stride, y * stride) : prev;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, c = i >= bpp ? up[i - bpp] : 0, u = up[i];
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) { const pp = a + u - c, pa = Math.abs(pp - a), pb = Math.abs(pp - u), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      else if (f !== 0) return null;
      cur[i] = v & 0xff;
    }
  }
  const max = (1 << depth) - 1;
  const sample = (row: number, i: number): number => {   // i-th sample of a row, scaled to 0..255
    if (depth === 16) return out.readUInt16BE(row * stride + i * 2) / 257;
    if (depth === 8) return out[row * stride + i];
    const bit = i * depth; const byte = out[row * stride + (bit >> 3)]; const v = (byte >> (8 - depth - (bit & 7))) & max;
    return ctype === 3 ? v : (v * 255) / max;
  };
  const px = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r: number, g: number, bl: number, a = 255;
    if (ctype === 3) { const k = sample(y, x); r = palette![k * 3] ?? 0; g = palette![k * 3 + 1] ?? 0; bl = palette![k * 3 + 2] ?? 0; if (trns && k < trns.length) a = trns[k]; }
    else if (ctype === 0) { r = g = bl = sample(y, x); }
    else if (ctype === 4) { r = g = bl = sample(y, x * 2); a = sample(y, x * 2 + 1); }
    else if (ctype === 2) { r = sample(y, x * 3); g = sample(y, x * 3 + 1); bl = sample(y, x * 3 + 2); }
    else { r = sample(y, x * 4); g = sample(y, x * 4 + 1); bl = sample(y, x * 4 + 2); a = sample(y, x * 4 + 3); }
    const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
    px[y * w + x] = (lum * a + 255 * (255 - a)) / 255;   // transparent paper reads as white
  }
  return { w, h, px };
}

// ───────────────────────────────────────── JPEG (DC terms of the luma blocks) ─────────────────────────────────────────
interface Huff { lookup: Map<number, number>[] }   // [codeLength] → code → symbol
function buildHuff(counts: Uint8Array, symbols: Uint8Array): Huff {
  const lookup: Map<number, number>[] = []; let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    const m = new Map<number, number>();
    for (let i = 0; i < counts[len - 1]; i++) m.set(code++, symbols[k++]);
    lookup[len] = m; code <<= 1;
  }
  return { lookup };
}
function decodeJpegDcGrey(b: Buffer): GreyImage | null {
  let p = 2; let w = 0, h = 0; let comps: { id: number; hs: number; vs: number; tq: number }[] = []; let restart = 0;
  const q0: number[] = [];   // DC quantiser step of each quantisation table
  const dc: (Huff | undefined)[] = [], ac: (Huff | undefined)[] = [];
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null;
    const marker = b[p + 1];
    if (marker === 0xff) { p++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
    const len = b.readUInt16BE(p + 2); const seg = b.subarray(p + 4, p + 2 + len);
    if (marker === 0xc0 || marker === 0xc1) {
      if (seg[0] !== 8) return null;   // 12-bit precision: not here
      h = seg.readUInt16BE(1); w = seg.readUInt16BE(3); const n = seg[5]; comps = [];
      for (let i = 0; i < n; i++) comps.push({ id: seg[6 + i * 3], hs: seg[7 + i * 3] >> 4, vs: seg[7 + i * 3] & 15, tq: seg[8 + i * 3] });
      if (!w || !h || w * h > MAX_PIXELS || !comps.length) return null;
    } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return null;   // progressive / lossless / arithmetic
    else if (marker === 0xc4) {
      let q = 0;
      while (q < seg.length) {
        const tc = seg[q] >> 4, th = seg[q] & 15; const counts = seg.subarray(q + 1, q + 17); const total = counts.reduce((s, x) => s + x, 0);
        const t = buildHuff(counts, seg.subarray(q + 17, q + 17 + total));
        if (tc === 0) dc[th] = t; else ac[th] = t;
        q += 17 + total;
      }
    } else if (marker === 0xdb) {
      let q = 0;
      while (q < seg.length) { const pq = seg[q] >> 4, tq = seg[q] & 15; q0[tq] = pq ? seg.readUInt16BE(q + 1) : seg[q + 1]; q += 1 + (pq ? 128 : 64); }
    } else if (marker === 0xdd) restart = seg.readUInt16BE(0);
    else if (marker === 0xda) {
      if (!comps.length) return null;
      const ns = seg[0]; const scan: { ci: number; td: number; ta: number }[] = [];
      for (let i = 0; i < ns; i++) { const ci = comps.findIndex((c) => c.id === seg[1 + i * 2]); if (ci < 0) return null; scan.push({ ci, td: seg[2 + i * 2] >> 4, ta: seg[2 + i * 2] & 15 }); }
      if (!scan.some((s) => s.ci === 0)) return null;   // the first scan must carry luma
      const img = decodeScan(b, p + 2 + len, w, h, comps, scan, dc, ac, restart);
      if (!img) return null;
      const step = q0[comps[0].tq] ?? 1;
      for (let i = 0; i < img.px.length; i++) img.px[i] = (img.px[i] * step) / 8 + 128;   // the block mean, 0–255
      return img;
    }
    p += 2 + len;
  }
  return null;
}
function decodeScan(b: Buffer, start: number, w: number, h: number, comps: { hs: number; vs: number }[], scan: { ci: number; td: number; ta: number }[],
  dcT: (Huff | undefined)[], acT: (Huff | undefined)[], restart: number): GreyImage | null {
  const hmax = Math.max(...comps.map((c) => c.hs)), vmax = Math.max(...comps.map((c) => c.vs));
  const Y = comps[0];
  let pos = start, bitBuf = 0, bitCnt = 0, hitMarker = false;
  const readBit = (): number => {
    if (bitCnt === 0) {
      if (hitMarker || pos >= b.length) { hitMarker = true; return 0; }
      let byte = b[pos++];
      if (byte === 0xff) { const nx = b[pos]; if (nx === 0x00) pos++; else { hitMarker = true; pos--; return 0; } }
      bitBuf = byte; bitCnt = 8;
    }
    bitCnt--; return (bitBuf >> bitCnt) & 1;
  };
  const receive = (n: number): number => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | readBit(); return v; };
  const extend = (v: number, n: number): number => (n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const decodeSym = (t: Huff): number => {
    let code = 0;
    for (let len = 1; len <= 16; len++) { code = (code << 1) | readBit(); const s = t.lookup[len].get(code); if (s !== undefined) return s; }
    throw new Error('bad huffman code');
  };
  const pred = new Array(comps.length).fill(0);
  const single = scan.length === 1;
  // block grid of the luma component
  const yCols = single ? Math.ceil(Math.ceil((w * Y.hs) / hmax) / 8) : Math.ceil(w / (8 * hmax)) * Y.hs;
  const yRows = single ? Math.ceil(Math.ceil((h * Y.vs) / vmax) / 8) : Math.ceil(h / (8 * vmax)) * Y.vs;
  if (yCols * yRows > MAX_PIXELS) return null;
  const px = new Float64Array(yCols * yRows);
  const block = (s: { ci: number; td: number; ta: number }): number => {
    const dt = dcT[s.td], at = acT[s.ta]; if (!dt || !at) throw new Error('missing huffman table');
    const t = decodeSym(dt); const diff = extend(receive(t), t); pred[s.ci] += diff; const dcv = pred[s.ci];
    for (let k = 1; k < 64;) {
      const rs = decodeSym(at); const r = rs >> 4, sz = rs & 15;
      if (sz === 0) { if (r === 15) { k += 16; continue; } break; }
      k += r; receive(sz); k++;
    }
    return dcv;
  };
  const mcusX = single ? yCols : Math.ceil(w / (8 * hmax)), mcusY = single ? yRows : Math.ceil(h / (8 * vmax));
  const total = mcusX * mcusY; let n = 0;
  for (let m = 0; m < total; m++) {
    if (restart && m > 0 && m % restart === 0) {
      // byte-align, expect RSTn, reset the predictors
      bitCnt = 0; hitMarker = false;
      while (pos + 1 < b.length && !(b[pos] === 0xff && b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) pos++;
      pos += 2; pred.fill(0);
    }
    const mx = m % mcusX, my = Math.floor(m / mcusX);
    if (single) { px[my * yCols + mx] = block(scan[0]); n++; continue; }
    for (const s of scan) {
      const c = comps[s.ci];
      for (let by = 0; by < c.vs; by++) for (let bx = 0; bx < c.hs; bx++) {
        const v = block(s);
        if (s.ci === 0) { const gx = mx * c.hs + bx, gy = my * c.vs + by; px[gy * yCols + gx] = v; n++; }
      }
    }
  }
  if (!n) return null;
  // crop the padding blocks beyond the picture
  const cw = Math.max(1, Math.min(yCols, Math.ceil(Math.ceil((w * Y.hs) / hmax) / 8))), ch = Math.max(1, Math.min(yRows, Math.ceil(Math.ceil((h * Y.vs) / vmax) / 8)));
  const crop = new Float64Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = px[y * yCols + x];
  return { w: cw, h: ch, px: crop };
}
