// ai-ocr-receipt.blob.vitest.spec.ts — the OCR blob store + malware-scan adapters.
//
// The tests that matter here are the NEGATIVE ones. This module handles a tenant's vendor invoices (totals,
// account numbers, supplier terms) and hands them to a human reviewer who then posts them to the books. Two
// failures would be worse than the feature not existing at all:
//   1. fabricating a preview URL that looks real but isn't, and
//   2. reporting a file `clean` when nothing scanned it.
// So most of what follows exists to prove neither can happen.
import { describe, it, expect } from 'vitest';
import { BlobFileStore, EvidenceMalwareScan, contentTypeFor, isNotConnectedUrl } from './ai-ocr-receipt.blob';
import { storageKeyFor } from './ai-ocr-receipt-upload';
import type { EvidenceBlobStore, SignedUrl } from '../tenant-safety-community/evidence-blob-store';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: [] as string[] } as any;
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

class FakeBlobs implements EvidenceBlobStore {
  readonly puts: { key: string; body: Buffer; contentType?: string }[] = [];
  constructor(readonly connected: boolean, private readonly signed: SignedUrl | null = null, private readonly throwOnPut = false) {}
  async put(key: string, body: Buffer, contentType?: string) {
    if (this.throwOnPut) throw new Error('bucket unreachable');
    this.puts.push({ key, body, contentType });
    return { key };
  }
  async signedUrl(): Promise<SignedUrl | null> { return this.signed; }
  async remove(): Promise<void> { /* no-op */ }
}

describe('BlobFileStore', () => {
  it('keys objects with storageKeyFor — the SAME key the service hands the scanner', async () => {
    // This is the bug that made the old DbFileStore unsafe: it wrote `tenants/{t}/ocr/{id}/original.{ext}`
    // while the service scanned `storageKeyFor(...)` = `tenants/{t}/documents/{id}/original.{ext}`. A real
    // scanner would have been asked about an object that was never written, and reported `unscanned` forever.
    const blobs = new FakeBlobs(true);
    const store = new BlobFileStore(null, blobs);
    const { storageKey } = await store.store(ctx, 'doc-1', 'pdf', BYTES);

    expect(storageKey).toBe(storageKeyFor('t1', 'doc-1', 'original', 'pdf'));
    expect(storageKey).toBe('tenants/t1/documents/doc-1/original.pdf');
    expect(blobs.puts[0].key).toBe(storageKey);           // stored under the key the scanner will look up
  });

  it('writes the real bytes, privately, with a correct content type', async () => {
    const blobs = new FakeBlobs(true);
    await new BlobFileStore(null, blobs).store(ctx, 'doc-2', 'png', BYTES);
    expect(blobs.puts).toHaveLength(1);
    expect([...blobs.puts[0].body]).toEqual([1, 2, 3, 4, 5]);
    expect(blobs.puts[0].contentType).toBe('image/png');
  });

  it('FAILS the upload if the blob write throws — never records metadata for an object that is not there', async () => {
    // A metadata row whose object does not exist is worse than a failed upload: the tenant believes the
    // receipt is filed, and the original is gone.
    const store = new BlobFileStore(null, new FakeBlobs(true, null, true));
    await expect(store.store(ctx, 'doc-3', 'pdf', BYTES)).rejects.toThrow(/bucket unreachable/);
  });

  it('returns a REAL signed URL when storage is connected', async () => {
    const signed = { url: 'https://bucket.s3.amazonaws.com/x?sig=abc', expiresAt: '2026-01-01T00:00:00.000Z' };
    const store = new BlobFileStore(null, new FakeBlobs(true, signed));
    const r = await store.signedPreview(ctx, 'tenants/t1/documents/doc-1/original.pdf');
    expect(r).toEqual(signed);
    expect(isNotConnectedUrl(r.url)).toBe(false);
  });

  it('NEVER fabricates a URL when storage is not connected — it returns the honest marker', async () => {
    const key = 'tenants/t1/documents/doc-1/original.pdf';
    const store = new BlobFileStore(null, new FakeBlobs(false));
    const r = await store.signedPreview(ctx, key);
    expect(r.url).toBe(`notconnected:${key}`);
    expect(isNotConnectedUrl(r.url)).toBe(true);
    expect(r.url.startsWith('http')).toBe(false);   // nothing a reviewer could click and believe
  });

  it('does not fabricate a URL when a CONNECTED store declines to sign', async () => {
    const store = new BlobFileStore(null, new FakeBlobs(true, null));   // connected, but signedUrl() → null
    const r = await store.signedPreview(ctx, 'tenants/t1/documents/doc-9/original.pdf');
    expect(isNotConnectedUrl(r.url)).toBe(true);
  });

  it('skips the blob write when the store is not connected (metadata-only, as before)', async () => {
    const blobs = new FakeBlobs(false);
    const { storageKey } = await new BlobFileStore(null, blobs).store(ctx, 'doc-4', 'jpg', BYTES);
    expect(blobs.puts).toHaveLength(0);
    expect(storageKey).toBe(storageKeyFor('t1', 'doc-4', 'original', 'jpg'));
  });
});

describe('contentTypeFor', () => {
  it('maps the allowed upload types', () => {
    expect(contentTypeFor('pdf')).toBe('application/pdf');
    expect(contentTypeFor('PNG')).toBe('image/png');
    expect(contentTypeFor('jpeg')).toBe('image/jpeg');
    expect(contentTypeFor('heic')).toBe('image/heic');
  });
  it('falls back to octet-stream rather than guessing', () => {
    expect(contentTypeFor('exe')).toBe('application/octet-stream');
    expect(contentTypeFor('')).toBe('application/octet-stream');
  });
});

describe('EvidenceMalwareScan', () => {
  const withStatus = (status: any) => new EvidenceMalwareScan({ async scan() { return { status }; } } as any);

  it('passes an explicit clean through', async () => {
    expect(await withStatus('clean').scan('t1', 'k')).toEqual({ status: 'clean' });
  });

  it('passes an explicit infected through', async () => {
    expect(await withStatus('infected').scan('t1', 'k')).toEqual({ status: 'infected' });
  });

  it('maps everything else to unscanned — NEVER clean', async () => {
    // No tag yet, a failed scan, an access-denied, a network blip, a missing SDK, or any value we do not
    // recognise. None of those is "clean". This is the whole safety property of the adapter.
    for (const s of ['unscanned', 'error', 'pending', 'FAILED', 'ACCESS_DENIED', '', null, undefined, 'anything']) {
      const r = await withStatus(s).scan('t1', 'k');
      expect(r.status, `status=${String(s)}`).toBe('unscanned');
      expect(r.status).not.toBe('clean');
    }
  });

  it('a scanner that throws does not become clean', async () => {
    const scan = new EvidenceMalwareScan({ async scan() { throw new Error('s3 down'); } } as any);
    await expect(scan.scan('t1', 'k')).rejects.toThrow();   // surfaces; it does NOT silently report clean
  });
});
