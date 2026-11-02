// receipt-capture-queue.test — §155 a capture queued offline is uploaded on reconnect and only then counts; §156 the bytes at
// rest are ciphertext (not the photo) under a non-extractable key, and without WebCrypto nothing is stored at all; §157 a
// confirmed upload is deleted at once, a failed one waits with its error, anything past 48 h is dropped unsent.
import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createReceiptCaptureQueue, InMemoryCaptureStore, CaptureUnavailableError, CAPTURE_TTL_MS, CAPTURE_MAX_QUEUED } from './receipt-capture-queue';

const ensureCrypto = () => { const g: any = globalThis; if (!g.crypto?.subtle) Object.defineProperty(g, 'crypto', { value: webcrypto, configurable: true }); };
const photo = (n = 5000) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 7 + 13) & 0xff; b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };

describe('receipt capture queue', () => {
  it('§155/§157: queued offline → metadata only is visible; sync uploads it, the server\'s documentId confirms it, and the capture is gone', async () => {
    ensureCrypto();
    const store = new InMemoryCaptureStore();
    const q = createReceiptCaptureQueue(store);
    const bytes = photo();
    const s = await q.enqueue({ filename: 'receipt.jpg', mimeType: 'image/jpeg', bytes, source: 'mobile_camera' });
    expect(s).toMatchObject({ filename: 'receipt.jpg', sizeBytes: 5000, attempts: 0, lastError: null });
    expect((await q.pending()).map((p) => p.id)).toEqual([s.id]);
    expect(Object.keys((await q.pending())[0])).not.toContain('bytes');
    const seen: Uint8Array[] = [];
    const upload = vi.fn(async (f: { bytes: Uint8Array }) => { seen.push(f.bytes); return { documentId: 'doc-1' }; });
    const r = await q.sync(upload);
    expect(r).toEqual({ uploaded: [{ id: s.id, documentId: 'doc-1', filename: 'receipt.jpg' }], failed: [], expired: [], skipped: 0 });
    expect(Array.from(seen[0])).toEqual(Array.from(bytes));                 // the server receives the ORIGINAL bytes
    expect(await q.pending()).toEqual([]);                                   // §157 deleted the moment it was confirmed
    expect(await q.sync(upload)).toMatchObject({ uploaded: [] }); expect(upload).toHaveBeenCalledTimes(1);
  });
  it('§156: what sits in the store is ciphertext under a non-extractable AES-GCM key — not the photo', async () => {
    ensureCrypto();
    const store = new InMemoryCaptureStore();
    const q = createReceiptCaptureQueue(store);
    const bytes = photo(2000);
    await q.enqueue({ filename: 'r.jpg', mimeType: 'image/jpeg', bytes, source: 'mobile_camera' });
    const raw = (await store.list())[0];
    const stored = new Uint8Array(raw.cipher);
    expect(stored.length).toBeGreaterThan(bytes.length);                     // GCM tag
    expect(Array.from(stored.slice(0, 3))).not.toEqual([0xff, 0xd8, 0xff]);  // no JPEG magic at rest
    let same = 0; for (let i = 0; i < bytes.length; i++) if (stored[i] === bytes[i]) same++;
    expect(same / bytes.length).toBeLessThan(0.05);
    const k = await store.loadKey();
    expect(k?.extractable).toBe(false);
    await expect((globalThis as any).crypto.subtle.exportKey('raw', k!)).rejects.toBeTruthy();
  });
  it('§156: without WebCrypto the queue refuses to hold the photo (never plain storage)', async () => {
    const g: any = globalThis; const saved = g.crypto;
    Object.defineProperty(g, 'crypto', { value: { getRandomValues: saved?.getRandomValues?.bind(saved) }, configurable: true });
    try {
      const q = createReceiptCaptureQueue(new InMemoryCaptureStore());
      await expect(q.enqueue({ filename: 'r.jpg', mimeType: 'image/jpeg', bytes: photo(10), source: 'mobile_camera' })).rejects.toBeInstanceOf(CaptureUnavailableError);
      expect(await q.pending()).toEqual([]);
    } finally { Object.defineProperty(g, 'crypto', { value: saved, configurable: true }); }
  });
  it('a failed upload waits with its error and attempt count (the expense is not saved); the next sync retries it; a server that does not confirm is a failure', async () => {
    ensureCrypto();
    const q = createReceiptCaptureQueue(new InMemoryCaptureStore());
    const a = await q.enqueue({ filename: 'a.jpg', mimeType: 'image/jpeg', bytes: photo(100), source: 'owner_app_upload' });
    const b = await q.enqueue({ filename: 'b.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4'), source: 'owner_app_upload' });
    let fail = true;
    const upload = vi.fn(async (f: { filename: string }) => { if (fail && f.filename === 'a.jpg') throw new Error('network down'); if (f.filename === 'b.pdf') return { documentId: '' } as any; return { documentId: 'doc-a' }; });
    const r1 = await q.sync(upload);
    expect(r1.uploaded).toEqual([]);
    expect(r1.failed.map((f) => [f.id, f.error])).toEqual([[a.id, 'network down'], [b.id, 'The server did not confirm the upload.']]);
    expect((await q.pending()).map((p) => [p.filename, p.attempts, p.lastError])).toEqual([['a.jpg', 1, 'network down'], ['b.pdf', 1, 'The server did not confirm the upload.']]);
    fail = false;
    const r2 = await q.sync(upload);
    expect(r2.uploaded.map((u) => u.documentId)).toEqual(['doc-a']);
    expect((await q.pending()).map((p) => p.filename)).toEqual(['b.pdf']);
    await q.discard(b.id);
    expect(await q.pending()).toEqual([]);
  });
  it('§157: a capture older than 48 hours is dropped unsent and reported; the queue is capped', async () => {
    ensureCrypto();
    const store = new InMemoryCaptureStore();
    const q = createReceiptCaptureQueue(store);
    const old = await q.enqueue({ filename: 'old.jpg', mimeType: 'image/jpeg', bytes: photo(10), source: 'mobile_camera' });
    const upload = vi.fn(async () => ({ documentId: 'x' }));
    const r = await q.sync(upload, Date.now() + CAPTURE_TTL_MS + 1000);
    expect(r.expired).toEqual([{ id: old.id, filename: 'old.jpg' }]); expect(upload).not.toHaveBeenCalled();
    expect(await q.pending()).toEqual([]);
    for (let i = 0; i < CAPTURE_MAX_QUEUED; i++) await q.enqueue({ filename: `${i}.jpg`, mimeType: 'image/jpeg', bytes: photo(4), source: 'mobile_camera' });
    await expect(q.enqueue({ filename: 'one-too-many.jpg', mimeType: 'image/jpeg', bytes: photo(4), source: 'mobile_camera' })).rejects.toBeInstanceOf(CaptureUnavailableError);
  });
  it('bindReconnect syncs on the online event (one sync at a time) and reports the result', async () => {
    ensureCrypto();
    const q = createReceiptCaptureQueue(new InMemoryCaptureStore());
    await q.enqueue({ filename: 'r.jpg', mimeType: 'image/jpeg', bytes: photo(10), source: 'mobile_camera' });
    const results: unknown[] = [];
    const upload = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return { documentId: 'doc-9' }; });
    const off = q.bindReconnect(upload, (r) => results.push(r));
    window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(results.length).toBeGreaterThanOrEqual(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(upload).toHaveBeenCalledTimes(1);                                  // the second `online` joined the running sync
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    off();
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 30));
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
