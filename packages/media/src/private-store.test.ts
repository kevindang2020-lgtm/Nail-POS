// BUILD_PLAN Phase 12: the PRIVATE object store (async export files) — never a URL, never outside its root.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskPrivateStore, makePrivateStore, privateObjectKey, safeFilename, S3PrivateStore } from './private-store';

describe('private object keys', () => {
  it('<env>/<namespace>/<owner>/<id>/<filename>, every segment validated, the name made one safe segment', () => {
    expect(privateObjectKey('operations', 'a1b2', 'op1', 'pos-customers.csv', { NODE_ENV: 'production' } as any)).toBe('production/operations/a1b2/op1/pos-customers.csv');
    expect(privateObjectKey('operations', 'platform', 'op1', '../../etc/passwd', { MEDIA_ENV: 'staging' } as any)).toBe('staging/operations/platform/op1/passwd');
    expect(() => privateObjectKey('operations', '..', 'op1', 'x.csv')).toThrow();
    expect(safeFilename('Q3 report (final).csv')).toBe('Q3-report-final-.csv');
    expect(safeFilename('')).toBe('export.bin');
  });
});

describe('the local private store', () => {
  it('stores, reads back, removes — owner-only file mode — and refuses a key that leaves its root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'p12-store-'));
    try {
      const s = new LocalDiskPrivateStore(root);
      const r = await s.put('development/operations/t/op/a.csv', Buffer.from('Name\nAnn\n'), 'text/csv');
      expect(r).toEqual({ key: 'development/operations/t/op/a.csv', bytes: 9 });   // a key, never a URL
      expect((await s.get(r.key))!.toString()).toBe('Name\nAnn\n');
      expect(statSync(join(root, r.key)).mode & 0o077).toBe(0);
      await expect(s.put('../outside.csv', Buffer.from('x'))).rejects.toThrow();
      expect(await s.get('../../etc/passwd')).toBeNull();
      await s.remove(r.key);
      expect(await s.get(r.key)).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('MEDIA_STORE=s3 uses a private bucket (PRIVATE_S3_BUCKET, else MEDIA_S3_BUCKET under private/); otherwise local disk', async () => {
    const sent: any[] = [];
    class Cmd { constructor(public input: any) {} }
    const sdk = { S3Client: class { send(c: any) { sent.push(c.input); return Promise.resolve({}); } }, PutObjectCommand: Cmd, GetObjectCommand: Cmd, DeleteObjectCommand: Cmd };
    const s = makePrivateStore({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'media-b', AWS_REGION: 'us-east-1' } as any, sdk);
    expect(s).toBeInstanceOf(S3PrivateStore);
    await s.put('development/operations/t/op/a.csv', Buffer.from('x'), 'text/csv');
    expect(sent[0]).toMatchObject({ Bucket: 'media-b', Key: 'private/development/operations/t/op/a.csv', ContentType: 'text/csv', ServerSideEncryption: 'AES256' });
    expect(sent[0].ACL).toBeUndefined();   // never public-read
    const root = mkdtempSync(join(tmpdir(), 'p12-store-'));
    try { expect(makePrivateStore({ PRIVATE_FILES_ROOT: root } as any).kind).toBe('local'); } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
