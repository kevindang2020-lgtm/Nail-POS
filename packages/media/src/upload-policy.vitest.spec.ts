// upload-policy.vitest.spec.ts — BUILD_PLAN Phase 12 / Constitution 5 §158–§166 (#34): one test per policy rule.
import { describe, it, expect } from 'vitest';
import { crc32 } from 'node:zlib';
import { imageInfo } from './image-info';
import {
  acceptUpload, checkDeclaredUpload, checkFileCount, sniffUpload, stripUploadMetadata, uploadObjectKey, UploadRejected, UPLOAD_POLICIES,
  type MalwareScanner, type StorageQuotaPort,
} from './upload-policy';

const B = (...parts: Array<number[] | string | Uint8Array>) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p as any))));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** A walkable JPEG: SOI, EXIF APP1 (orientation 6 + a "GPS" payload), COM, SOF0 w×h, SOS, data, EOI. */
function jpeg(w = 40, h = 30, orientation = 6): Buffer {
  const tiff = B('MM', [0, 0x2a], be32(8), be16(1), be16(0x0112), be16(3), be32(1), be16(orientation), [0, 0], be32(0), 'GPS-SECRET-40.7128N');
  const app1 = B([0xff, 0xe1], be16(2 + 6 + tiff.length), 'Exif', [0, 0], tiff);
  const com = B([0xff, 0xfe], be16(2 + 13), 'SECRET-SERIAL');
  const sof = B([0xff, 0xc0], be16(11), [8], be16(h), be16(w), [1, 1, 0x11, 0]);
  const sos = B([0xff, 0xda], be16(8), [1, 1, 0, 0, 0x3f, 0]);
  return B([0xff, 0xd8], app1, com, sof, sos, [1, 2, 3, 4, 5, 6, 7, 8], [0xff, 0xd9]);
}
const chunk = (type: string, data: Buffer) => { const td = B(type, data); return B(be32(data.length), td, be32(crc32(td) >>> 0)); };
function png(): Buffer {
  return B([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', B(be32(20), be32(10), [8, 2, 0, 0, 0])), chunk('tEXt', B('Location', [0], 'SECRET-HOME')),
    chunk('IDAT', B([0x78, 0x9c, 1, 2, 3])), chunk('IEND', Buffer.alloc(0)));
}
function webp(): Buffer {
  const vp8x = B('VP8X', le32(10), [0x08, 0, 0, 0], [19, 0, 0], [9, 0, 0]);            // EXIF flag, 20×10 canvas
  const exif = B('EXIF', le32(12), 'SECRET-GPS!!');
  const vp8l = B('VP8L', le32(5), [0x2f, 0, 0, 0, 0], [0]);
  const body = B('WEBP', vp8x, exif, vp8l);
  return B('RIFF', le32(body.length), body);
}
function mp4(): Buffer {
  const xyz = B(be32(8 + 15), '\xa9xyz', 'SECRET+40.7-74');
  const udta = B(be32(8 + xyz.length), 'udta', xyz);
  const mvhd = B(be32(16), 'mvhd', [0, 0, 0, 0, 0, 0, 0, 0]);
  const moov = B(be32(8 + mvhd.length + udta.length), 'moov', mvhd, udta);
  return B(be32(16), 'ftyp', 'isom', be32(0), moov, B(be32(12), 'mdat', [9, 9, 9, 9]));
}

describe('sniffing — the bytes decide (§160)', () => {
  it('recognises every accepted kind from its leading bytes', () => {
    expect(sniffUpload(jpeg())).toBe('jpeg');
    expect(sniffUpload(png())).toBe('png');
    expect(sniffUpload(webp())).toBe('webp');
    expect(sniffUpload(mp4())).toBe('mp4');
    expect(sniffUpload(B('%PDF-1.7\n'))).toBe('pdf');
    expect(sniffUpload(B([0, 0, 0, 24], 'ftypqt  ', be32(0)))).toBe('mov');
    expect(sniffUpload(B([0, 0, 0, 24], 'ftypheic', be32(0)))).toBe('heic');
    expect(sniffUpload(B('name,phone\nAnn,555\n'))).toBe('text');
  });
  it('markup, scripts and executables are none of them — whatever their name says', () => {
    expect(sniffUpload(B('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffUpload(B('\ufeff  <svg onload="x()"/>'))).toBeNull();
    expect(sniffUpload(B('MZ\x90\x00\x03\x00\x00\x00', [0, 0, 0, 0]))).toBeNull();
    expect(sniffUpload(B('abc', [0], 'def'))).toBeNull();   // binary with a NUL is not text
  });
});

describe('acceptUpload — the policy rules', () => {
  const P = UPLOAD_POLICIES;
  const reason = async (p: Promise<unknown>) => { try { await p; return 'accepted'; } catch (e) { return e instanceof UploadRejected ? e.reason : String(e); } };

  it('size: refused over the policy limit with 413 PAYLOAD_TOO_LARGE, before the bytes are sniffed', async () => {
    const big = Buffer.concat([B('<html>'), Buffer.alloc(P.salonLogo.maxBytes)]);
    const e = await acceptUpload(P.salonLogo, { bytes: big }).catch((x) => x);
    expect(e).toBeInstanceOf(UploadRejected);
    expect([e.reason, e.status, e.code]).toEqual(['TOO_LARGE', 413, 'PAYLOAD_TOO_LARGE']);
    expect(await reason(acceptUpload(P.avatar, { bytes: Buffer.alloc(0) }))).toBe('EMPTY');
  });
  it('type: a kind the policy does not allow is refused (a PDF as an avatar, a video as a logo)', async () => {
    expect(await reason(acceptUpload(P.avatar, { bytes: B('%PDF-1.4 ...') }))).toBe('TYPE_NOT_ALLOWED');
    expect(await reason(acceptUpload(P.salonLogo, { bytes: mp4() }))).toBe('TYPE_NOT_ALLOWED');
    expect(await reason(acceptUpload(P.avatar, { bytes: B('<html><body>hi</body></html>'), filename: 'me.png', declaredType: 'image/png' }))).toBe('TYPE_NOT_ALLOWED');
  });
  it('extension allowlist: a client name outside the policy is refused; the STORED extension is the sniffed one', async () => {
    expect(await reason(acceptUpload(P.avatar, { bytes: jpeg(), filename: 'payload.html' }))).toBe('EXTENSION_NOT_ALLOWED');
    expect(await reason(acceptUpload(P.avatar, { bytes: jpeg(), filename: 'x.svg' }))).toBe('EXTENSION_NOT_ALLOWED');
    const a = await acceptUpload(P.avatar, { bytes: jpeg(), filename: 'from-canvas.png' });   // a JPEG named .png (canvas exports do this)
    expect([a.kind, a.ext, a.contentType]).toEqual(['jpeg', 'jpg', 'image/jpeg']);
  });
  it('declared type: outside the policy → refused; a different FAMILY than the bytes → MIME_MISMATCH', async () => {
    expect(await reason(acceptUpload(P.supportAttachment, { bytes: B('hello'), declaredType: 'text/html' }))).toBe('TYPE_NOT_ALLOWED');
    expect(await reason(acceptUpload(P.showcaseMedia, { bytes: jpeg(), declaredType: 'video/mp4' }))).toBe('MIME_MISMATCH');
    const csv = await acceptUpload(P.supportAttachment, { bytes: B('a,b\n1,2\n'), declaredType: 'text/csv' });
    expect([csv.kind, csv.ext, csv.contentType]).toEqual(['text', 'csv', 'text/csv']);
  });
  it('images: the header must parse and the pixel count is capped (decompression bomb)', async () => {
    expect(await reason(acceptUpload(P.avatar, { bytes: jpeg(30_000, 30_000) }))).toBe('DIMENSIONS_TOO_LARGE');
    expect(await reason(acceptUpload(P.avatar, { bytes: B([0xff, 0xd8, 0xff, 0xe0], be16(2), [0x12, 0x34], Buffer.alloc(20)) }))).toBe('UNREADABLE');
    const ok = await acceptUpload(P.avatar, { bytes: jpeg(40, 30, 6) });
    expect([ok.width, ok.height]).toEqual([30, 40]);   // orientation 6 = a quarter turn
  });
  it('malware hook: infected is refused; a scanner error never blocks as "clean" — the verdict is unscanned', async () => {
    const infected: MalwareScanner = { async scan() { return { status: 'infected' }; } };
    expect(await reason(acceptUpload(P.avatar, { bytes: jpeg() }, { scanner: infected }))).toBe('MALWARE');
    const broken: MalwareScanner = { async scan() { throw new Error('scanner down'); } };
    expect((await acceptUpload(P.avatar, { bytes: jpeg() }, { scanner: broken })).scanStatus).toBe('unscanned');
    expect((await acceptUpload(P.avatar, { bytes: jpeg() })).scanStatus).toBe('unscanned');
  });
  it('quota: the stored size is reserved against the salon — unless the multipart guard already reserved the request', async () => {
    const calls: Array<[string, number]> = [];
    const quota: StorageQuotaPort = { async reserveStorage(t, n) { calls.push([t, n]); if (n > 10_000) throw new Error('QUOTA_EXCEEDED'); }, async releaseStorage() {} };
    const a = await acceptUpload(P.salonLogo, { bytes: png(), tenantId: 't1' }, { quota });
    expect(calls).toEqual([['t1', a.size]]);
    expect(a.quotaReservedBytes).toBe(a.size);
    await acceptUpload(P.avatar, { bytes: jpeg(), tenantId: 't1', quotaReserved: true }, { quota });
    expect(calls).toHaveLength(1);
    await expect(acceptUpload(P.showcaseMedia, { bytes: Buffer.concat([mp4(), Buffer.alloc(20_000)]), tenantId: 't1' }, { quota })).rejects.toThrow('QUOTA_EXCEEDED');
  });
  it('checkDeclaredUpload (presigned PUT, before signing): size, name and declared type with no bytes', () => {
    expect(() => checkDeclaredUpload(P.safetyEvidence, { sizeBytes: 100, declaredType: 'image/png', filename: 'a.png' })).not.toThrow();
    expect(() => checkDeclaredUpload(P.safetyEvidence, { sizeBytes: P.safetyEvidence.maxBytes + 1 })).toThrow(/larger than 15 MB/);
    expect(() => checkDeclaredUpload(P.safetyEvidence, { sizeBytes: 100, declaredType: 'text/html' })).toThrow(UploadRejected);
  });
  it('file count per request', () => {
    expect(() => checkFileCount(P.avatar, 1)).not.toThrow();
    expect(() => checkFileCount(P.avatar, 2)).toThrow(/at most 1 file/);
    expect(() => checkFileCount(P.profilePhoto, 11)).toThrow(/at most 10 files/);
  });
});

describe('metadata is stripped from public images and videos (§164)', () => {
  it('JPEG: EXIF (GPS), comments gone; the orientation survives in a minimal EXIF; the picture is the same', async () => {
    const src = jpeg(40, 30, 6);
    const a = await acceptUpload(UPLOAD_POLICIES.avatar, { bytes: src });
    expect(a.metadataStripped).toBe(true);
    expect(a.bytes.toString('latin1')).not.toMatch(/SECRET/);
    expect(imageInfo(a.bytes, 'jpeg')).toEqual({ width: 40, height: 30, orientation: 6 });
    expect(a.bytes.subarray(a.bytes.length - 12).equals(src.subarray(src.length - 12))).toBe(true);   // scan data + EOI untouched
    const upright = stripUploadMetadata(jpeg(40, 30, 1), 'jpeg').bytes;
    expect(Buffer.from(upright).toString('latin1')).not.toMatch(/Exif/);
  });
  it('PNG: text / EXIF / time chunks dropped, every other chunk kept as it was', () => {
    const { bytes, stripped } = stripUploadMetadata(png(), 'png');
    expect(stripped).toBe(true);
    const s = Buffer.from(bytes).toString('latin1');
    expect(s).not.toMatch(/SECRET|tEXt/);
    expect(s).toMatch(/IHDR[\s\S]*IDAT[\s\S]*IEND/);
    expect(imageInfo(bytes, 'png')).toEqual({ width: 20, height: 10, orientation: 1 });
  });
  it('WebP: EXIF chunk dropped, its VP8X flag cleared, the RIFF size rewritten', () => {
    const { bytes } = stripUploadMetadata(webp(), 'webp');
    const b = Buffer.from(bytes);
    expect(b.toString('latin1')).not.toMatch(/SECRET|EXIF/);
    expect(b.readUInt32LE(4)).toBe(b.length - 8);
    expect(b[20] & 0x08).toBe(0);
    expect(imageInfo(b, 'webp')).toMatchObject({ width: 20, height: 10 });
  });
  it('MP4: the udta box (Apple location atom) becomes a zeroed free box of the SAME size — offsets stay valid', () => {
    const src = mp4();
    const { bytes, stripped } = stripUploadMetadata(src, 'mp4');
    expect(stripped).toBe(true);
    expect(bytes.length).toBe(src.length);
    const s = Buffer.from(bytes).toString('latin1');
    expect(s).not.toMatch(/SECRET|udta/);
    expect(s).toMatch(/moov.*mvhd.*free/s);
    expect(Buffer.from(bytes).subarray(bytes.length - 12).equals(src.subarray(src.length - 12))).toBe(true);
  });
  it('a policy that keeps the original exact (evidence) does not touch the bytes', async () => {
    const src = jpeg();
    const a = await acceptUpload(UPLOAD_POLICIES.ocrReceipt, { bytes: src });
    expect(a.metadataStripped).toBe(false);
    expect(a.bytes.equals(src)).toBe(true);
  });
});

describe('uploadObjectKey — tenant-scoped, random, nothing from the client (§162)', () => {
  it('builds tenants/<tenant>/<area>/<owner>/<random>.<ext>, or global/… without a salon', () => {
    const k = uploadObjectKey({ tenantId: 'a1b2', area: 'avatars', owner: ['staff', 'u1'], ext: 'jpg' });
    expect(k).toMatch(/^tenants\/a1b2\/avatars\/staff\/u1\/[0-9a-f]{24}\.jpg$/);
    expect(uploadObjectKey({ tenantId: null, area: 'avatars', owner: ['customer', null], ext: 'png' })).toMatch(/^global\/avatars\/customer\/none\/[0-9a-f]{24}\.png$/);
    expect(k).not.toBe(uploadObjectKey({ tenantId: 'a1b2', area: 'avatars', owner: ['staff', 'u1'], ext: 'jpg' }));
  });
  it('refuses a traversal or separator in any segment, and an odd extension', () => {
    expect(() => uploadObjectKey({ tenantId: 't', area: '../etc', ext: 'jpg' })).toThrow();
    expect(() => uploadObjectKey({ tenantId: 't', area: 'a', owner: ['x/y'], ext: 'jpg' })).toThrow();
    expect(() => uploadObjectKey({ tenantId: 't/..', area: 'a', ext: 'jpg' })).toThrow();
    expect(() => uploadObjectKey({ tenantId: 't', area: 'a', ext: 'php.jpg' })).toThrow();
  });
});
