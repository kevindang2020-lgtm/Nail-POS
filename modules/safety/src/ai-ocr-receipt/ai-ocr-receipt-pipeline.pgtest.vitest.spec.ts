// ai-ocr-receipt-pipeline.pgtest — M3 (Oct 23 2026) on the REAL migrated schema: a document is never its own duplicate;
// the extracted number + date are kept; the upload's verdict lands on the file row; the sweep's population query finds
// every salon's stalled documents (and only stalled ones).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyDocStore, KyselyOcrAuditSink, KyselySettingsStore } from './ai-ocr-receipt.kysely';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import { BlobFileStore } from './ai-ocr-receipt.blob';
import { detectDuplicates } from './ai-ocr-receipt-dedup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const fixture = (n: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', 'phash', n)));

const T1 = 'a3440000-0000-4000-8000-000000000001', T2 = 'a3440000-0000-4000-8000-000000000002';
const ctx = (t: string) => ({ tenantId: t, branchId: null, userId: null, role: 'OWNER', permissions: [] }) as any;
let pg: any; let db: any; let docs: KyselyDocStore;
const notConnected: any = { connected: false, async put() {}, async signedUrl() { return null; } };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); docs = new KyselyDocStore(db);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'A','A','ocr-a-m3','OCRA3','active'), ($2,'B','B','ocr-b-m3','OCRB3','active')`, [T1, T2]);
}, 180000);

describe('receipt pipeline store on the real schema (M3)', () => {
  it('dedup: the document being checked never matches ITSELF; another with the same file hash does', async () => {
    const files = new BlobFileStore(db, notConnected);
    const a = await docs.create(ctx(T1), { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    const b = await docs.create(ctx(T1), { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    const bytes = new TextEncoder().encode('%PDF-1.7 same receipt');
    await files.store(ctx(T1), a.id, 'pdf', bytes); await files.store(ctx(T1), b.id, 'pdf', bytes);
    const subject = { fileHash: null, perceptualHash: null, vendor: null, documentNumber: null, documentDate: null, totalCents: null };
    const forA = await docs.dedupCandidates(ctx(T1), subject, a.id);
    expect(forA.map((c) => c.documentId)).toContain(b.id);
    expect(forA.map((c) => c.documentId)).not.toContain(a.id);
    expect((await docs.dedupCandidates(ctx(T1), subject)).map((c) => c.documentId)).toContain(a.id);   // without the id: unchanged
  });
  it('the extracted document number and date are kept on the document', async () => {
    const d = await docs.create(ctx(T1), { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    await docs.patch(ctx(T1), d.id, { pipelineState: 'review_required', documentNumber: 'INV-4417', documentDate: '2026-10-21' } as any);
    expect(await docs.get(ctx(T1), d.id)).toMatchObject({ documentNumber: 'INV-4417', documentDate: '2026-10-21', pipelineState: 'review_required' });
  });
  it('the upload\'s scan verdict lands on the file row (it said unscanned forever)', async () => {
    const files = new BlobFileStore(db, notConnected);
    const d = await docs.create(ctx(T1), { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    await files.store(ctx(T1), d.id, 'pdf', new TextEncoder().encode('%PDF-1.7 x'));
    await files.recordScan(ctx(T1), d.id, 'clean');
    expect((await pg.query(`SELECT scan_status FROM ocr_document_files WHERE document_id = $1`, [d.id])).rows[0].scan_status).toBe('clean');
  });
  it('the sweep population: every salon\'s quarantined / extracting documents older than the cutoff — not fresh ones, not reviewed ones', async () => {
    const q = await docs.create(ctx(T2), { pipelineState: 'quarantined', documentType: 'unknown', postingVersion: 1 });
    const x = await docs.create(ctx(T1), { pipelineState: 'extracting', documentType: 'unknown', postingVersion: 1 });
    const fresh = await docs.create(ctx(T1), { pipelineState: 'quarantined', documentType: 'unknown', postingVersion: 1 });
    const reviewed = await docs.create(ctx(T1), { pipelineState: 'in_review', documentType: 'unknown', postingVersion: 1 });
    await pg.query(`UPDATE ocr_documents SET updated_at = now() - interval '1 hour' WHERE id = ANY($1::uuid[])`, [[q.id, x.id, reviewed.id]]);
    const got = await docs.stalled(['quarantined', 'scanning', 'extracting'], new Date(Date.now() - 10 * 60_000), 100);
    const ids = got.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([q.id, x.id]));
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(reviewed.id);
    expect(got.find((d) => d.id === q.id)).toMatchObject({ tenantId: T2, pipelineState: 'quarantined' });
  });
  it('the sweep end to end, as the SYSTEM (systemContext): a quarantined receipt the scanner now calls clean is released and audited (user NULL, role SYSTEM)', async () => {
    const d = await docs.create(ctx(T1), { pipelineState: 'quarantined', documentType: 'unknown', postingVersion: 1 });
    const files = new BlobFileStore(db, notConnected);
    await files.store(ctx(T1), d.id, 'pdf', new TextEncoder().encode('%PDF-1.7 sweep'));
    await pg.query(`UPDATE ocr_documents SET updated_at = now() - interval '1 hour' WHERE id = $1`, [d.id]);
    const svc = new AiOcrReceiptService(docs, new KyselySettingsStore(db), files, { async scan() { return { status: 'clean' }; } } as any, {} as any, new KyselyOcrAuditSink(db), []);
    const r = await svc.sweepPipeline(new Date(), { minAgeMs: 10 * 60_000 });
    expect(r.errors).toBe(0);
    expect(r.released).toBeGreaterThanOrEqual(1);
    expect((await docs.get(ctx(T1), d.id))?.pipelineState).toBe('extracting');
    const audit = (await pg.query(`SELECT user_id, role, action_type FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`, [d.id])).rows;
    expect(audit.at(-1)).toMatchObject({ user_id: null, role: 'SYSTEM', action_type: 'document.rescanned' });
  });
  // §31 (Oct 27 2026): the perceptual hash is written at upload from the same bytes as the file hash, and finds a
  // re-photographed copy of the same receipt that the file hash cannot (different bytes).
  it('§31: a re-photographed copy (smaller, brighter, JPEG q55) of a PNG receipt is a LIKELY duplicate by perceptual hash; another receipt and another salon\'s copy are not; a PDF has no perceptual hash', async () => {
    const files = new BlobFileStore(db, notConnected);
    const T3 = 'a3440000-0000-4000-8000-000000000003';
    await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'C','C','ocr-c-p31','OCRC31','active') ON CONFLICT (id) DO NOTHING`, [T3]);
    const mk = async (t: string, name: string, ext: string) => { const d = await docs.create(ctx(t), { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 }); await files.store(ctx(t), d.id, ext, fixture(name)); return d.id; };
    const original = await mk(T3, 'a.png', 'png');
    const other = await mk(T3, 'b.jpg', 'jpg');
    const elsewhere = await mk(T2, 'a.png', 'png');   // the same picture in ANOTHER salon
    const rephoto = await mk(T3, 'a-rephoto.jpg', 'jpg');
    const pdf = await docs.create(ctx(T3), { pipelineState: 'uploaded', documentType: 'unknown', postingVersion: 1 });
    await files.store(ctx(T3), pdf.id, 'pdf', new TextEncoder().encode('%PDF-1.7 receipt'));
    const row = async (id: string) => (await pg.query(`SELECT file_hash, perceptual_hash FROM ocr_document_files WHERE document_id = $1`, [id])).rows[0];
    expect((await row(original)).perceptual_hash).toMatch(/^[0-9a-f]{16}$/);
    expect((await row(pdf.id)).perceptual_hash).toBeNull();
    const me = (await docs.get(ctx(T3), rephoto))!;
    expect(me.perceptualHash).toBe((await row(rephoto)).perceptual_hash);
    expect(me.fileHash).not.toBe((await row(original)).file_hash);                       // the bytes differ: the file hash cannot see it
    const subject = { fileHash: me.fileHash, perceptualHash: me.perceptualHash, vendor: null, documentNumber: null, documentDate: null, totalCents: null };
    const cands = await docs.dedupCandidates(ctx(T3), subject, rephoto);
    expect(cands.map((c) => c.documentId)).not.toContain(elsewhere);                     // tenant isolation is structural
    const r = detectDuplicates(subject, cands);
    expect(r).toMatchObject({ status: 'likely', blocksAutoProcessing: true });
    expect(r.matches.find((m) => m.documentId === original)).toMatchObject({ status: 'likely', reason: 'perceptual_near_match' });
    expect(r.matches.find((m) => m.documentId === other)).toBeUndefined();
  });
});
