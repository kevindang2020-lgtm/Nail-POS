// ai-ocr-receipt-close.pgtest — Receipt / Expense mandate close-out (Oct 27 2026) on the REAL migrated schema (through 700):
//   §12       the upload records the caller's channel (pos_upload / owner_app_upload …), 'upload' for anything else
//   §25/§26   the upload answers the quality flags (a tiny dark image is "difficult"; a PDF has no verdict) and never rejects on them
//   §24/§159  a decodable image gets a thumbnail (+ a review copy when large) beside the untouched original — only with a bucket;
//             without one nothing is pretended (thumbnailKey null)
//   §17/§18   page 2 … are appended under ONE document (page_count, ocr_document_pages, a file row each), deferExtraction holds
//             the automatic run, the provider receives every page key, and a merged reading reports pages = files
//   §113/§114 with the job port bound the upload enqueues and answers in `extracting` (the worker extracts); unbound it reads inline
//   §115      a connected provider that fails: attempt 1 and 2 → extraction_failed with a due time (1 min, 2 min), the sweep
//             retries when due; attempt 3 → the dead letter (no due time, processing_failed max_attempts); a person's retry
//             starts the ladder again; no provider at all → manual_entry_required at once (nothing to retry)
//   §142      a receipt that reaches review carries the finance module's suggestion (MATCHED → suggested_expense_id); nothing is linked
//   §131      retention marks old documents archived (never deletes), keeps one whose expense is live, honours retention_hold
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { deflateSync } from 'node:zlib';
import { KyselyDocStore, KyselyOcrAuditSink, KyselySettingsStore } from './ai-ocr-receipt.kysely';
import { AiOcrReceiptService, OCR_MAX_EXTRACTION_ATTEMPTS, extractionRetryDelayMs, uploadRefusalFor } from './ai-ocr-receipt.service';
import { BlobFileStore } from './ai-ocr-receipt.blob';
import { mergeNormalizedResults, type OcrProvider, type OcrInput, type NormalizedOcrResult } from './ai-ocr-receipt-pipeline';
import { PostingService } from './ai-ocr-receipt-posting';

const T1 = 'a7000000-0000-4000-8000-000000000001', T2 = 'a7000000-0000-4000-8000-000000000002';
const U1 = 'a7000000-0000-4000-8000-0000000000e1';
const ctx = (t: string, userId: string | null = U1) => ({ tenantId: t, branchId: null, userId, role: 'OWNER', permissions: [] }) as any;
let pg: any; let db: any; let docs: KyselyDocStore;
const notConnected: any = { connected: false, async put() {}, async signedUrl() { return null; } };
/** an in-memory "bucket" so derivatives and pages are really stored */
const memBucket = () => { const objects = new Map<string, { bytes: Buffer; type: string }>(); return { connected: true, objects, async put(k: string, b: Buffer, t: string) { objects.set(k, { bytes: b, type: t }); }, async signedUrl(k: string) { return objects.has(k) ? { url: `https://signed.test/${k}`, expiresAt: new Date(Date.now() + 60_000).toISOString() } : null; } } as any; };
/** an 8-bit grey PNG (the receipt: paper + text lines) */
function png(w: number, h: number, f: (x: number, y: number) => number): Uint8Array {
  const crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch('IHDR', ihdr), ch('IDAT', deflateSync(raw)), ch('IEND', Buffer.alloc(0))]));
}
/** every call draws a DIFFERENT receipt (line spacing, desk shade, text offset) — the same bytes twice would rightly be an exact duplicate (duplicate_hold) */
let seed = 0;
const receiptPng = (w = 700, h = 900) => {
  const k = seed++; const step = 9 + (k % 7), off = (k * 5) % 40;
  // a different desk texture per seed (a slow diagonal pattern) so the dHash of two test receipts is nowhere near the other's
  const desk = (x: number, y: number) => 40 + (((x * (k * 7 + 3)) + (y * (k * 11 + 5))) >> 5) % 170;
  // the paper sits in a different third of the frame per seed and every other seed is photographed on a light desk with
  // dark paper (inverted) — the 9×8 dHashes then differ in most bits (a near-identical layout twice is a near-duplicate, by design)
  const paperL = w * (0.05 + (k % 4) * 0.08), paperR = w * (0.95 - ((k + 1) % 4) * 0.08), paperT = h * ((k % 3) * 0.3 + 0.02), paperB = paperT + h * 0.36;
  const inv = k % 2 === 1;
  return png(w, h, (x, y) => { const v = (x > paperL && x < paperR && y > paperT && y < paperB) ? ((y + off) % step < 3 && ((x + k) >> 2) % 3 ? 20 : 245) : desk(x, y); return inv ? 255 - v : v; });
};
const darkTinyPng = () => png(120, 160, () => 15);
const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.7 ${s}`);
const upload = (bytes: Uint8Array, name: string, mime: string, extra: Record<string, unknown> = {}) => ({ filename: name, declaredMime: mime, sizeBytes: bytes.length, headerBytes: bytes.slice(0, 16), bytes, ...extra }) as any;
const read = (fields: Array<{ key: string; text: string; cents?: number; confidence?: number }>, lines = 0, pages = 1): NormalizedOcrResult => ({ unavailable: false, providerKey: 'test', textRedacted: 'receipt thank you for your purchase', pages, overallConfidence: 0.95,
  fields: fields.map((f) => ({ key: f.key, text: f.text, cents: f.cents ?? null, confidence: f.confidence ?? 0.95 })), lineItems: Array.from({ length: lines }, (_, i) => ({ description: `line ${i + 1}`, quantity: 1, unitPriceCents: 100, lineTotalCents: 100, confidence: 0.9 })) });
const scanner: any = { async scan() { return { status: 'clean' }; } };
const settingsRow = async (t: string, config: Record<string, unknown>) => pg.query(`INSERT INTO tenant_ocr_ai_settings (tenant_id, level, enabled, config, version) VALUES ($1, 'tenant', true, $2::jsonb, 1) ON CONFLICT DO NOTHING`, [t, JSON.stringify(config)]);
const build = (opts: { bucket?: any; providers?: OcrProvider[]; jobs?: boolean; suggestions?: any } = {}) => {
  const files = new BlobFileStore(db, opts.bucket ?? notConnected);
  const svc = new AiOcrReceiptService(docs, new KyselySettingsStore(db), files, scanner, new PostingService({ async saveReceiptExpense() { throw new Error('unbound'); } } as any, {} as any, { async find() { return null; }, async record() {} }), new KyselyOcrAuditSink(db), opts.providers ?? []);
  const enqueued: string[] = [];
  if (opts.jobs) svc.extractionJobs = { async enqueue(_c, id) { enqueued.push(id); } };
  if (opts.suggestions) svc.expenseSuggestions = opts.suggestions;
  return { svc, files, enqueued };
};

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); docs = new KyselyDocStore(db);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'A','A','ocr-close-a','OCRCA','active'), ($2,'B','B','ocr-close-b','OCRCB','active')`, [T1, T2]);
  await pg.query(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ($1, $2, 'O', 'O', 'O O', 'o@ocr-close.test', 'active', 'OWNER')`, [U1, T1]);
  await settingsRow(T1, { malwareScanRequired: false, autoPipeline: true, maxPages: 3 });
  await settingsRow(T2, { malwareScanRequired: false, autoPipeline: true });
}, 180000);

describe('§12 / §25 / §24 upload answers', () => {
  it('records the caller\'s channel, measures the image itself and answers the quality flags; a PDF has no verdict; nothing is rejected on a flag', async () => {
    const { svc } = build();
    const good = await svc.upload(ctx(T1), upload(receiptPng(), 'r.png', 'image/png', { source: 'owner_app_upload' }));
    expect(good.quality).toEqual({ flags: [], difficult: false });
    expect(await docs.get(ctx(T1), good.documentId)).toMatchObject({ sourceChannel: 'owner_app_upload', qualityFlags: [], pageCount: 1 });
    const bad = await svc.upload(ctx(T1), upload(darkTinyPng(), 'dark.png', 'image/png', { source: 'mobile_camera' }));
    expect(bad.quality.difficult).toBe(true);
    expect(bad.quality.flags).toEqual(expect.arrayContaining(['low_resolution', 'too_dark']));
    expect(['extracting', 'manual_entry_required', 'review_required']).toContain(bad.pipelineState);   // accepted — a flag is advice
    expect((await docs.get(ctx(T1), bad.documentId))?.qualityFlags).toEqual(expect.arrayContaining(['low_resolution', 'too_dark']));
    const p = await svc.upload(ctx(T1), upload(pdf('invoice'), 'i.pdf', 'application/pdf'));
    expect(p.quality).toEqual({ flags: [], difficult: false });
    expect((await docs.get(ctx(T1), p.documentId))?.sourceChannel).toBe('upload');                   // no channel named → 'upload'
    expect((await pg.query(`SELECT metadata_json->>'source' AS s FROM audit_logs WHERE entity_id = $1 AND action_type = 'document.uploaded'`, [good.documentId])).rows[0].s).toBe('owner_app_upload');
  });
  it('a decodable image gets a thumbnail (and a review copy when large) in the bucket, as file rows, beside the untouched original; without a bucket nothing is pretended', async () => {
    const bucket = memBucket();
    const { svc } = build({ bucket });
    const original = receiptPng(1400, 2100); const copy = Uint8Array.from(original);
    const r = await svc.upload(ctx(T1), upload(original, 'big.png', 'image/png'));
    expect(r.thumbnailKey).toBe(`tenants/${T1}/documents/${r.documentId}/thumbnail.png`);
    const files = (await pg.query(`SELECT kind, storage_key, mime_type FROM ocr_document_files WHERE document_id = $1 ORDER BY kind`, [r.documentId])).rows;
    expect(files.map((f: any) => f.kind)).toEqual(['original', 'thumbnail']);          // 1400×2100 grey PNG is far under 2 MB → no review copy
    expect(bucket.objects.get(r.thumbnailKey!)?.type).toBe('image/png');
    expect(bucket.objects.get(`tenants/${T1}/documents/${r.documentId}/original.png`)?.bytes).toEqual(Buffer.from(copy));   // §19 untouched
    expect((await docs.get(ctx(T1), r.documentId))?.thumbnailKey).toBe(r.thumbnailKey);
    expect((await docs.list(ctx(T1), {})).items.find((d) => d.id === r.documentId)?.thumbnailKey).toBe(r.thumbnailKey);
    // the thumbnail is served through the same document-bound signed preview (never a public URL)
    expect((await svc.previewUrl(ctx(T1), r.documentId, r.thumbnailKey!)).url).toContain('thumbnail.png');
    await expect(svc.previewUrl(ctx(T2), r.documentId, r.thumbnailKey!)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const none = await build().svc.upload(ctx(T1), upload(receiptPng(), 'r2.png', 'image/png'));
    expect(none.thumbnailKey).toBeNull();
    expect((await pg.query(`SELECT kind FROM ocr_document_files WHERE document_id = $1`, [none.documentId])).rows.map((f: any) => f.kind)).toEqual(['original']);
  });
});

describe('§17 / §18 multi-page documents', () => {
  it('pages append under ONE document; deferExtraction holds the automatic run; the provider gets every page key; a merged reading reports the pages; the salon\'s maxPages caps it', async () => {
    const seen: OcrInput[] = [];
    const provider: OcrProvider = { key: 'test', connected: true, costRank: 1, supports: () => true, async extract(input) { seen.push(input); return mergeNormalizedResults([read([{ key: 'vendor', text: 'Salon Equipment Direct' }], 1), read([{ key: 'total', text: '$1,258.18', cents: 125818 }, { key: 'document_date', text: '2026-10-05' }], 0)]); } };
    const bucket = memBucket();
    const { svc } = build({ bucket, providers: [provider] });
    const first = await svc.upload(ctx(T1), upload(receiptPng(), 'p1.png', 'image/png', { source: 'pos_upload', deferExtraction: true }));
    expect(first.pipelineState).toBe('extracting');                                     // held — not read yet
    expect(seen).toHaveLength(0);
    const p2 = await svc.appendPage(ctx(T1), first.documentId, upload(receiptPng(), 'p2.png', 'image/png'));
    expect(p2).toMatchObject({ documentId: first.documentId, pageCount: 2, pipelineState: 'extracting' });
    const p3 = await svc.appendPage(ctx(T1), first.documentId, upload(pdf('page 3'), 'p3.pdf', 'application/pdf'));
    expect(p3.pageCount).toBe(3);
    await expect(svc.appendPage(ctx(T1), first.documentId, upload(receiptPng(), 'p4.png', 'image/png'))).rejects.toMatchObject({ code: 'INVALID_UPLOAD' });   // maxPages 3
    const pages = (await pg.query(`SELECT page_number, storage_key FROM ocr_document_pages WHERE document_id = $1 ORDER BY page_number`, [first.documentId])).rows;
    expect(pages.map((p: any) => p.page_number)).toEqual([2, 3]);
    expect(pages[0].storage_key).toBe(`tenants/${T1}/documents/${first.documentId}/page-2.png`);
    expect(bucket.objects.has(pages[1].storage_key)).toBe(true);
    expect((await pg.query(`SELECT count(*)::int AS c FROM ocr_document_files WHERE document_id = $1 AND kind = 'original'`, [first.documentId])).rows[0].c).toBe(3);
    expect((await docs.get(ctx(T1), first.documentId))?.pageCount).toBe(3);
    // the caller runs extraction once the pages are in: ONE reading over every page, pages = 2 readings merged here
    const ex = await svc.runExtraction(ctx(T1), first.documentId);
    expect(ex.pipelineState).toBe('review_required');
    expect(seen).toHaveLength(1);
    expect(seen[0].pageCount).toBe(3);
    expect(seen[0].pageKeys).toEqual(pages.map((p: any) => p.storage_key));
    const d = await docs.get(ctx(T1), first.documentId);
    expect(d).toMatchObject({ vendor: 'Salon Equipment Direct', totalCents: 125818, documentDate: '2026-10-05', pageCount: 3 });
    expect(await docs.get(ctx(T1), first.documentId).then((x) => x?.sourceChannel)).toBe('pos_upload');
    // one document, one expense: there is exactly one document row, never three
    expect((await pg.query(`SELECT count(*)::int AS c FROM ocr_documents WHERE tenant_id = $1 AND id = $2`, [T1, first.documentId])).rows[0].c).toBe(1);
    // a page cannot be added once the document is in review; another salon cannot add a page to it
    await expect(svc.appendPage(ctx(T1), first.documentId, upload(receiptPng(), 'late.png', 'image/png'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.appendPage(ctx(T2), first.documentId, upload(receiptPng(), 'x.png', 'image/png'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('mergeNormalizedResults keeps the most confident reading of a field read on two pages and concatenates line items', () => {
    const m = mergeNormalizedResults([read([{ key: 'total', text: '$1.00', cents: 100, confidence: 0.6 }], 2), read([{ key: 'total', text: '$2.00', cents: 200, confidence: 0.9 }, { key: 'vendor', text: 'V' }], 3)]);
    expect(m.pages).toBe(2); expect(m.lineItems).toHaveLength(5);
    expect(m.fields.find((f) => f.key === 'total')).toMatchObject({ cents: 200, page: 2 });
    expect(mergeNormalizedResults([{ unavailable: true, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 }]).unavailable).toBe(true);
  });
});

describe('§113 / §114 / §115 extraction off the request thread, with the retry ladder and the dead letter', () => {
  it('with the job port bound the upload enqueues and answers in extracting; the handler-equivalent runExtraction then reads it; without the port it reads inline', async () => {
    let n = 0;   // each reading is a different purchase — the same vendor / total / date twice would rightly be a duplicate_hold
    const provider: OcrProvider = { key: 'test', connected: true, costRank: 1, supports: () => true, async extract() { n++; return read([{ key: 'vendor', text: 'ABC Nail Supply' }, { key: 'total', text: `$${88 + n}.99`, cents: 8899 + n * 100 }, { key: 'document_date', text: `2026-10-${10 + n}` }]); } };
    const queued = build({ providers: [provider], jobs: true });
    const r = await queued.svc.upload(ctx(T1), upload(receiptPng(), 'q.png', 'image/png'));
    expect(r.pipelineState).toBe('extracting');
    expect(queued.enqueued).toEqual([r.documentId]);
    expect((await queued.svc.runExtraction(ctx(T1, null), r.documentId)).pipelineState).toBe('review_required');   // what the worker does
    const inline = build({ providers: [provider] });
    expect((await inline.svc.upload(ctx(T1), upload(receiptPng(), 'i.png', 'image/png'))).pipelineState).toBe('review_required');
  });
  it('a connected provider that fails: two scheduled retries with backoff (the sweep runs them when due), then the dead letter; a person\'s retry starts over; no provider → manual entry at once', async () => {
    let calls = 0; let ok = false;
    const flaky: OcrProvider = { key: 'flaky', connected: true, costRank: 1, supports: () => true, async extract() { calls++; return ok ? read([{ key: 'vendor', text: 'PSE&G' }, { key: 'total', text: '$312.44', cents: 31244 }, { key: 'document_date', text: '2026-10-13' }]) : { unavailable: true, providerKey: null, textRedacted: null, pages: 0, fields: [], lineItems: [], overallConfidence: 0 }; } };
    const { svc } = build({ providers: [flaky] });
    const r = await svc.upload(ctx(T1), upload(receiptPng(), 'f.png', 'image/png'));   // inline attempt 1 fails
    expect(r.pipelineState).toBe('extraction_failed');
    let d = await docs.get(ctx(T1), r.documentId);
    expect(d).toMatchObject({ extractionAttempts: 1, lastExtractionError: 'extraction_unavailable' });
    expect(d!.nextExtractionAt).not.toBeNull();
    expect(new Date(d!.nextExtractionAt!).getTime() - Date.now()).toBeGreaterThan(extractionRetryDelayMs(1) - 5_000);
    // not due yet → the sweep leaves it; due → the sweep retries (attempt 2 fails → waits 2 min)
    expect((await svc.sweepPipeline(new Date(), { minAgeMs: 0 })).retried).toBe(0);
    expect((await svc.sweepPipeline(new Date(Date.now() + extractionRetryDelayMs(1) + 1000), { minAgeMs: 10 * 60_000 })).retried).toBe(1);
    d = await docs.get(ctx(T1), r.documentId);
    expect(d).toMatchObject({ pipelineState: 'extraction_failed', extractionAttempts: 2 });
    expect(calls).toBe(2);
    // attempt 3 fails → the dead letter: no due time, a processing_failed with max_attempts, the sweep never picks it again
    expect((await svc.sweepPipeline(new Date(Date.now() + 60 * 60_000), { minAgeMs: 10 * 60_000 })).retried).toBe(1);
    d = await docs.get(ctx(T1), r.documentId);
    expect(d).toMatchObject({ pipelineState: 'extraction_failed', extractionAttempts: OCR_MAX_EXTRACTION_ATTEMPTS, nextExtractionAt: null });
    expect((await svc.sweepPipeline(new Date(Date.now() + 24 * 60 * 60_000), { minAgeMs: 10 * 60_000 })).retried).toBe(0);
    expect(calls).toBe(3);
    expect((await pg.query(`SELECT action_type FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`, [r.documentId])).rows.map((x: any) => x.action_type)).toEqual(expect.arrayContaining(['document.extraction_retry_scheduled', 'document.extraction_dead_letter']));
    // the Super Admin overview's dead-letter population is countable: extraction_failed with no due time
    expect((await pg.query(`SELECT count(*)::int AS c FROM ocr_documents WHERE pipeline_status = 'extraction_failed' AND next_extraction_at IS NULL`)).rows[0].c).toBeGreaterThanOrEqual(1);
    // a person retries: the ladder restarts, and this time the provider answers
    ok = true;
    const again = await svc.retryExtraction(ctx(T1), r.documentId);
    expect(again.pipelineState).toBe('review_required');
    expect((await docs.get(ctx(T1), r.documentId))).toMatchObject({ extractionAttempts: 1, nextExtractionAt: null, lastExtractionError: null, vendor: 'PSE&G' });
    await expect(svc.retryExtraction(ctx(T1), r.documentId)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // no provider bound: manual entry at once — nothing to retry
    const none = await build().svc.upload(ctx(T1), upload(receiptPng(), 'n.png', 'image/png'));
    expect(none.pipelineState).toBe('manual_entry_required');
    expect(await docs.get(ctx(T1), none.documentId)).toMatchObject({ extractionAttempts: 1, nextExtractionAt: null, lastExtractionError: 'no_provider' });
  });
});

describe('§74/§75 the upload switches', () => {
  it('with the policy bound, a front-desk / technician upload is refused (403, the reason named) until the owner turns the switch on; an owner is never asked', async () => {
    const switches = { receptionistUpload: false, technicianUpload: false };
    const { svc } = build();
    svc.uploadPolicy = { async refuse(c) { return uploadRefusalFor(c.role, switches); } };
    const front = { ...ctx(T1), role: 'FRONT_DESK' }, tech = { ...ctx(T1), role: 'TECHNICIAN' };
    await expect(svc.upload(front, upload(receiptPng(), 'fd.png', 'image/png'))).rejects.toMatchObject({ code: 'FORBIDDEN', extra: { reason: 'receptionist_upload_off' } });
    await expect(svc.upload(tech, upload(receiptPng(), 'tech.png', 'image/png'))).rejects.toMatchObject({ code: 'FORBIDDEN', extra: { reason: 'technician_upload_off' } });
    expect((await svc.upload(ctx(T1), upload(receiptPng(), 'owner.png', 'image/png'))).documentId).toBeTruthy();
    switches.receptionistUpload = true;
    expect((await svc.upload(front, upload(receiptPng(), 'fd2.png', 'image/png'))).documentId).toBeTruthy();
    expect(uploadRefusalFor('MANAGER', null)).toBeNull();
    expect(uploadRefusalFor('RECEPTION', null)).toBe('receptionist_upload_off');
  });
});

describe('§35–§38 the per-field reading is stored; a correction is stored', () => {
  it('after extraction every field (with its confidence + state) and every line item is on the document; the weak field is low; a correction is persisted, replaces the document total the posting reads, and marks the field manually_corrected; a confirm marks it manually_confirmed', async () => {
    const provider: OcrProvider = { key: 'test', connected: true, costRank: 1, supports: () => true, async extract() { return read([{ key: 'vendor', text: 'Beauty Supply Warehouse', confidence: 0.98 }, { key: 'total', text: '$61.74', cents: 6174, confidence: 0.9 }, { key: 'tax', text: '$3.84', cents: 384, confidence: 0.55 }, { key: 'document_date', text: '2026-10-14', confidence: 0.9 }], 3); } };
    const { svc } = build({ providers: [provider] });
    const r = await svc.upload(ctx(T1), upload(receiptPng(), 'fields.png', 'image/png'));
    expect(r.pipelineState).toBe('review_required');
    const x = await svc.extraction(ctx(T1), r.documentId);
    expect(x.fields.map((f) => [f.key, f.state])).toEqual([['vendor', 'high'], ['total', 'high'], ['tax', 'low'], ['document_date', 'high']]);
    expect(x.lineItems).toHaveLength(3);
    expect((await pg.query(`SELECT tax_cents, overall_confidence FROM ocr_documents WHERE id = $1`, [r.documentId])).rows[0]).toMatchObject({ tax_cents: 384 });
    // the finance module's evidence view (what postFromReceipt reads) now has the breakdown, the fields and the lines
    const ev = (await pg.query(`SELECT count(*)::int AS c FROM ocr_line_items WHERE document_id = $1`, [r.documentId])).rows[0].c;
    expect(ev).toBe(3);
    // a correction of the total: stored on the field row AND on the document row
    const c = await svc.correctField(ctx(T1), r.documentId, 'total', { value: '$61.47', valueCents: 6147 });
    expect(c).toMatchObject({ fieldKey: 'total', valueCents: 6147, state: 'manually_corrected' });
    expect((await docs.get(ctx(T1), r.documentId))?.totalCents).toBe(6147);
    expect((await svc.extraction(ctx(T1), r.documentId)).fields.find((f) => f.key === 'total')).toMatchObject({ correctedValue: '$61.47', cents: 6147, state: 'manually_corrected' });
    // a confirm of the weak tax field
    expect((await svc.correctField(ctx(T1), r.documentId, 'tax', { confirmOnly: true })).state).toBe('manually_confirmed');
    // a field the provider never read (manual entry) is created by the person's value
    await svc.correctField(ctx(T1), r.documentId, 'document_number', { value: 'R-4471' });
    expect((await docs.get(ctx(T1), r.documentId))?.documentNumber).toBe('R-4471');
    // the audit names before / after; another salon cannot correct it; a posted document is not corrected
    expect((await pg.query(`SELECT count(*)::int AS c FROM audit_logs WHERE entity_id = $1 AND action_type = 'document.field_corrected'`, [r.documentId])).rows[0].c).toBe(3);
    await expect(svc.correctField(ctx(T2), r.documentId, 'total', { valueCents: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.correctField(ctx(T1), r.documentId, 'bad key!', { valueCents: 1 })).rejects.toMatchObject({ code: 'INVALID_UPLOAD' });
    // Oct 28 2026 (audit F1, §36 / §37 / §200): a corrected tax / subtotal / fees / discount lands on the DOCUMENT ROW — the
    // columns postFromReceipt reads (expense.repository receiptEvidence) — not only on the field; a negative part is refused
    await svc.correctField(ctx(T1), r.documentId, 'tax', { value: '$4.10', valueCents: 410 });
    await svc.correctField(ctx(T1), r.documentId, 'subtotal', { value: '$57.37', valueCents: 5737 });
    await svc.correctField(ctx(T1), r.documentId, 'fees', { value: '$0.00', valueCents: 0 });
    await svc.correctField(ctx(T1), r.documentId, 'discount', { value: '$1.00', valueCents: 100 });
    expect((await pg.query(`SELECT subtotal_cents::int AS s, tax_cents::int AS t, fees_cents::int AS f, discount_cents::int AS d FROM ocr_documents WHERE id = $1`, [r.documentId])).rows[0])
      .toEqual({ s: 5737, t: 410, f: 0, d: 100 });
    await expect(svc.correctField(ctx(T1), r.documentId, 'tax', { valueCents: -5 })).rejects.toMatchObject({ code: 'INVALID_UPLOAD' });
    // extras OCR #02 / RDR #05: the review workspace gets the money parts as they stand now and the arithmetic evidence
    // (the same reconcileDocument rule): 3 lines × $1.00 ≠ the $57.37 subtotal; $57.37 + $4.10 + $0 − $1.00 = $60.47 ≠ the $61.47 total
    const ev2 = await svc.extraction(ctx(T1), r.documentId);
    expect(ev2.amounts).toEqual({ subtotalCents: 5737, taxCents: 410, feesCents: 0, discountCents: 100, totalCents: 6147 });
    expect(ev2.arithmetic).toEqual([
      { name: 'line_items_vs_subtotal', passed: false, expectedCents: 5737, actualCents: 300, deltaCents: 300 - 5737 },
      { name: 'components_vs_total', passed: false, expectedCents: 6047, actualCents: 6147, deltaCents: 100 },
    ]);
    const before2 = (await pg.query(`SELECT total_cents::int AS t, subtotal_cents::int AS s, pipeline_status FROM ocr_documents WHERE id = $1`, [r.documentId])).rows[0];
    await svc.correctField(ctx(T1), r.documentId, 'total', { value: '$60.47', valueCents: 6047 });
    expect((await svc.extraction(ctx(T1), r.documentId)).arithmetic.find((c) => c.name === 'components_vs_total')).toMatchObject({ passed: true, deltaCents: 0 });
    expect(before2.s).toBe(5737);   // reading the evidence never changed the row (only the person's correction did)
  });
});

describe('§142 the suggestion of an existing expense, §131 retention', () => {
  it('a receipt reaching review carries the finance suggestion (stored on the document, in the event) — and links nothing', async () => {
    const EXP = 'a7000000-0000-4000-8000-00000000ee01';
    let n = 0;
    const provider: OcrProvider = { key: 'test', connected: true, costRank: 1, supports: () => true, async extract() { n++; return read([{ key: 'vendor', text: 'Lotus Flowers' }, { key: 'total', text: `$43.2${n}`, cents: 4320 + n }, { key: 'document_date', text: '2026-10-14' }]); } };
    const asked: string[] = [];
    const { svc } = build({ providers: [provider], suggestions: { async suggestExpenseForReceipt(_c: any, id: string) { asked.push(id); return { verdict: 'matched', expenseId: EXP, reason: 'same_total,same_vendor,same_date' }; } } });
    const r = await svc.upload(ctx(T1), upload(receiptPng(), 's.png', 'image/png'));
    expect(r.pipelineState).toBe('review_required');
    expect(asked).toEqual([r.documentId]);
    expect(await docs.get(ctx(T1), r.documentId)).toMatchObject({ suggestedExpenseId: EXP, suggestedMatch: 'matched' });
    expect((await pg.query(`SELECT count(*)::int AS c FROM expenses WHERE receipt_document_id = $1`, [r.documentId])).rows[0].c).toBe(0);   // suggested, never linked
    expect((await pg.query(`SELECT metadata_json->>'suggestedMatch' AS m FROM audit_logs WHERE entity_id = $1 AND action_type = 'document.extracted'`, [r.documentId])).rows[0].m).toBe('matched');
    // a suggestion port that fails never fails the receipt
    const broken = build({ providers: [provider], suggestions: { async suggestExpenseForReceipt() { throw new Error('finance away'); } } });
    const r2 = await broken.svc.upload(ctx(T1), upload(receiptPng(), 's2.png', 'image/png'));
    expect(r2.pipelineState).toBe('review_required');
    expect((await docs.get(ctx(T1), r2.documentId))?.suggestedMatch).toBeNull();
  });
  it('retention archives (never deletes) documents past the salon\'s window, keeps one with a live expense, honours retention_hold and the 30-day floor', async () => {
    const { svc } = build();
    const old = await docs.create(ctx(T1), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    const live = await docs.create(ctx(T1), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    const held = await docs.create(ctx(T1), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    const young = await docs.create(ctx(T1), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    await pg.query(`UPDATE ocr_documents SET created_at = now() - interval '8 years' WHERE id = ANY($1::uuid[])`, [[old.id, live.id, held.id]]);
    await pg.query(`UPDATE ocr_documents SET retention_hold = true WHERE id = $1`, [held.id]);
    await pg.query(`INSERT INTO expenses (tenant_id, status, kind, category, category_source, amount_cents, vendor, incurred_on, source, receipt_document_id, created_by, updated_by) VALUES ($1, 'approved', 'expense', 'supplies', 'owner', 100, 'V', '2018-01-01', 'manual', $2, $3, $3)`, [T1, live.id, U1]);
    const r = await svc.sweepRetention(new Date());
    expect(r).toMatchObject({ archived: 1, keptLiveExpense: 1, errors: 0 });
    const rows = (await pg.query(`SELECT id, retention_archived_at, deleted_at FROM ocr_documents WHERE id = ANY($1::uuid[])`, [[old.id, live.id, held.id, young.id]])).rows;
    const by = (id: string) => rows.find((x: any) => x.id === id)!;
    expect(by(old.id).retention_archived_at).not.toBeNull(); expect(by(old.id).deleted_at).toBeNull();      // archived, never deleted
    expect(by(live.id).retention_archived_at).toBeNull();
    expect(by(held.id).retention_archived_at).toBeNull();
    expect(by(young.id).retention_archived_at).toBeNull();
    expect((await pg.query(`SELECT count(*)::int AS c FROM ocr_document_files WHERE document_id = $1`, [old.id])).rows[0].c).toBe(0);   // nothing of it was removed either (there was nothing to remove)
    // a salon that set 30 days (the floor): a 31-day-old document is archived, a 20-day-old one is not
    await pg.query(`UPDATE tenant_ocr_ai_settings SET config = config || '{"retentionDays": 30}'::jsonb WHERE tenant_id = $1 AND level = 'tenant'`, [T2]);
    const a = await docs.create(ctx(T2), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    const b = await docs.create(ctx(T2), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    await pg.query(`UPDATE ocr_documents SET created_at = now() - interval '31 days' WHERE id = $1`, [a.id]);
    await pg.query(`UPDATE ocr_documents SET created_at = now() - interval '20 days' WHERE id = $1`, [b.id]);
    expect((await svc.sweepRetention(new Date())).archived).toBe(1);
    expect((await pg.query(`SELECT retention_archived_at FROM ocr_documents WHERE id = $1`, [a.id])).rows[0].retention_archived_at).not.toBeNull();
    expect((await pg.query(`SELECT retention_archived_at FROM ocr_documents WHERE id = $1`, [b.id])).rows[0].retention_archived_at).toBeNull();
    expect((await svc.sweepRetention(new Date())).archived).toBe(0);   // idempotent
  });
  it('Oct 28 re-audit: kept documents (live expense) never fill the nightly batch — an archivable one behind them is reached', async () => {
    const { svc } = build();
    const keptOld = await docs.create(ctx(T1), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    const archivable = await docs.create(ctx(T1), { pipelineState: 'posted', documentType: 'receipt', postingVersion: 1 });
    await pg.query(`UPDATE ocr_documents SET created_at = now() - interval '9 years' WHERE id = $1`, [keptOld.id]);
    await pg.query(`UPDATE ocr_documents SET created_at = now() - interval '8 years' WHERE id = $1`, [archivable.id]);
    await pg.query(`INSERT INTO expenses (tenant_id, status, kind, category, category_source, amount_cents, vendor, incurred_on, source, receipt_document_id, created_by, updated_by) VALUES ($1, 'approved', 'expense', 'supplies', 'owner', 100, 'V', '2017-01-01', 'manual', $2, $3, $3)`, [T1, keptOld.id, U1]);
    expect((await svc.sweepRetention(new Date(), { limit: 1 })).archived).toBe(1);   // ordered by age alone, the batch of 1 was the kept one
    expect((await pg.query(`SELECT retention_archived_at FROM ocr_documents WHERE id = $1`, [archivable.id])).rows[0].retention_archived_at).not.toBeNull();
  });
});
