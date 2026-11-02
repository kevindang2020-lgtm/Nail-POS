// media-storage-s3.vitest.spec.ts — Scaling Phase 4: verifies the S3/object-storage media backend and its env selector.
// A fake AWS SDK is injected (no live S3 and no installed dependency, mirroring how Redis-backed features are
// unit-tested by logic + fallback). Covers: the selector defaults to local disk, falls back to local disk on misconfig;
// and that the S3 adapter builds correct object keys + public/CDN URLs and never exposes a local path (serving via URL).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeMediaStorage, S3MediaStorage, LocalDiskMediaStorage } from './media-storage';

const sent: any[] = [];
const fakeSdk = {
  S3Client: class { async send(cmd: any) { sent.push(cmd); return {}; } },
  PutObjectCommand: class { type = 'put'; constructor(public input: any) {} },
  DeleteObjectCommand: class { type = 'del'; constructor(public input: any) {} },
};
beforeEach(() => { sent.length = 0; });
// the local-disk fallback gets a tmp root (never the package dir)
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), 'media-sel-'));
afterAll(() => rmSync(MEDIA_ROOT, { recursive: true, force: true }));

describe('makeMediaStorage selector (Phase 4)', () => {
  it('defaults to local disk when MEDIA_STORE is unset', () => {
    expect(makeMediaStorage({ MEDIA_ROOT } as any)).toBeInstanceOf(LocalDiskMediaStorage);
  });
  it('falls back to local disk (does not crash) when MEDIA_STORE=s3 but the bucket is missing', () => {
    expect(makeMediaStorage({ MEDIA_STORE: 's3', MEDIA_ROOT } as any)).toBeInstanceOf(LocalDiskMediaStorage);
  });
});

describe('S3MediaStorage (Phase 4)', () => {
  it('put() stores under the key prefix and returns a CDN URL when configured', async () => {
    const st = new S3MediaStorage({ bucket: 'b', region: 'us-east-1', keyPrefix: 'media', cdnBaseUrl: 'https://cdn.example.com' }, fakeSdk as any);
    const { url } = await st.put('tech/123/avatar.jpg', Buffer.from('x'));
    expect(url).toBe('https://cdn.example.com/tech/123/avatar.jpg');
    const put = sent.find((c) => c.type === 'put');
    expect(put.input.Bucket).toBe('b');
    expect(put.input.Key).toBe('media/tech/123/avatar.jpg');
  });
  it('put() returns a bucket URL when no CDN base is set', async () => {
    const st = new S3MediaStorage({ bucket: 'b', region: 'us-west-2' }, fakeSdk as any);
    const { url } = await st.put('/logo.png', Buffer.from('x'));
    expect(url).toBe('https://b.s3.us-west-2.amazonaws.com/logo.png');
  });
  it('rejects path-traversal keys', async () => {
    const st = new S3MediaStorage({ bucket: 'b', region: 'us-east-1' }, fakeSdk as any);
    await expect(st.put('../../etc/passwd', Buffer.from('x'))).rejects.toThrow('Invalid media key');
  });
  it('resolvePath() returns null — objects are served by URL, never streamed locally', () => {
    const st = new S3MediaStorage({ bucket: 'b', region: 'us-east-1' }, fakeSdk as any);
    expect(st.resolvePath()).toBeNull();
  });
  it('remove() issues a delete and never throws', async () => {
    const st = new S3MediaStorage({ bucket: 'b', region: 'us-east-1' }, fakeSdk as any);
    await st.remove('tech/1/x.jpg');
    expect(sent.some((c) => c.type === 'del')).toBe(true);
  });
});
