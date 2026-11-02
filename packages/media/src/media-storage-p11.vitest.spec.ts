// media-storage-p11.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §56–62, §169, audit finding E7).
// One region source (MEDIA_S3_REGION ?? AWS_REGION — writes and URLs can no longer disagree), no hard-coded bucket,
// production with MEDIA_STORE=s3 and no bucket/region is a boot error, structured keys carry an <env>/ segment (and
// tenantMediaKey puts the tenant right after it), legacy rows and URLs keep resolving, and abandoned temp/multipart
// uploads are swept.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  S3MediaStorage, LocalDiskMediaStorage, makeMediaStorage, buildMediaUrl, mediaRegion, mediaEnvSegment,
  mediaStorageConfigErrors, tenantMediaKey,
} from './media-storage';

const sent: any[] = [];
let uploads: any[] = [];
const fakeSdk = {
  S3Client: class { opts: any; constructor(o: any) { this.opts = o; } async send(cmd: any) { sent.push(cmd); if (cmd.type === 'list') return { Uploads: uploads }; return {}; } },
  PutObjectCommand: class { type = 'put'; constructor(public input: any) {} },
  DeleteObjectCommand: class { type = 'del'; constructor(public input: any) {} },
  ListMultipartUploadsCommand: class { type = 'list'; constructor(public input: any) {} },
  AbortMultipartUploadCommand: class { type = 'abort'; constructor(public input: any) {} },
};
beforeEach(() => { sent.length = 0; uploads = []; });

describe('E7 — one region source', () => {
  it('MEDIA_S3_REGION wins, then AWS_REGION, and there is NO built-in default', () => {
    expect(mediaRegion({ MEDIA_S3_REGION: 'eu-west-1', AWS_REGION: 'us-west-2' } as any)).toBe('eu-west-1');
    expect(mediaRegion({ AWS_REGION: 'us-west-2' } as any)).toBe('us-west-2');
    expect(mediaRegion({} as any)).toBeUndefined();
  });
  it('the write client and the public URL use the SAME region', async () => {
    const st = new S3MediaStorage({ bucket: 'b', region: 'ca-central-1' }, fakeSdk as any);
    const { url } = await st.put('x/y.png', Buffer.from('x'));
    expect((st as any).client.opts.region).toBe('ca-central-1');
    expect(url).toBe('https://b.s3.ca-central-1.amazonaws.com/x/y.png');
    const env = { MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', AWS_REGION: 'ca-central-1', MEDIA_S3_FOLDER_IMAGES: 'images' } as any;
    expect(buildMediaUrl('avatar-1.png', env)).toBe('https://b.s3.ca-central-1.amazonaws.com/images/avatar-1.png');
  });
  it('the S3 adapter refuses to start without a region (no silent us-east-1)', () => {
    const prev = { a: process.env.AWS_REGION, m: process.env.MEDIA_S3_REGION };
    delete process.env.AWS_REGION; delete process.env.MEDIA_S3_REGION;
    try { expect(() => new S3MediaStorage({ bucket: 'b' }, fakeSdk as any)).toThrow(/region/i); }
    finally { if (prev.a !== undefined) process.env.AWS_REGION = prev.a; if (prev.m !== undefined) process.env.MEDIA_S3_REGION = prev.m; }
  });
  it('an S3-compatible endpoint (R2/MinIO) needs no AWS region', () => {
    expect(() => new S3MediaStorage({ bucket: 'b', endpoint: 'http://minio:9000' }, fakeSdk as any)).not.toThrow();
  });
});

describe('E7 — no hard-coded bucket; production refuses a half-configured S3 store', () => {
  it('buildMediaUrl never invents power-salon-bucket / us-east-2', () => {
    for (const env of [{}, { MEDIA_STORE: 's3' }, { MEDIA_STORE: 's3', AWS_REGION: 'us-west-2' }] as any[]) {
      const u = String(buildMediaUrl('avatar-1.png', env));
      expect(u).not.toMatch(/power-salon-bucket|us-east-2/);
    }
    expect(buildMediaUrl('avatar-1.png', {} as any)).toBe('/media/avatar-1.png');
  });
  it('mediaStorageConfigErrors: production requires MEDIA_STORE=s3 with bucket and region; disk is refused unless MEDIA_STORE_ALLOW_DISK=1', () => {
    expect(mediaStorageConfigErrors({ NODE_ENV: 'production', MEDIA_STORE: 's3' } as any)).toEqual([
      expect.stringMatching(/MEDIA_S3_BUCKET/), expect.stringMatching(/MEDIA_S3_REGION/),
    ]);
    expect(mediaStorageConfigErrors({ NODE_ENV: 'production', MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', AWS_REGION: 'us-east-1' } as any)).toEqual([]);
    expect(mediaStorageConfigErrors({ NODE_ENV: 'production', MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_ENDPOINT: 'https://r2' } as any)).toEqual([]);
    // mandate §210 (Oct 20 2026): production with MEDIA_STORE unset / 'disk' REFUSES to start (uploads on the container
    // disk are lost at every deploy) — before, this passed and only MEDIA_STORE=s3 with missing settings was refused
    expect(mediaStorageConfigErrors({ NODE_ENV: 'production' } as any)).toEqual([expect.stringMatching(/MEDIA_STORE must be s3 in production \(it is unset\)/)]);
    expect(mediaStorageConfigErrors({ NODE_ENV: 'production', MEDIA_STORE: 'disk' } as any)).toEqual([expect.stringMatching(/it is "disk"/)]);
    expect(mediaStorageConfigErrors({ NODE_ENV: 'production', MEDIA_STORE_ALLOW_DISK: '1' } as any)).toEqual([]);   // the explicit, documented escape hatch
    expect(mediaStorageConfigErrors({ NODE_ENV: 'development', MEDIA_STORE: 's3' } as any)).toEqual([]);
  });
});

describe('§56–62 — <env>/<tenantId>/… keys', () => {
  it('the env segment: MEDIA_ENV, else derived from NODE_ENV, sanitised', () => {
    expect(mediaEnvSegment({ MEDIA_ENV: 'Staging' } as any)).toBe('staging');
    expect(mediaEnvSegment({ NODE_ENV: 'production' } as any)).toBe('production');
    expect(mediaEnvSegment({} as any)).toBe('development');
    expect(mediaEnvSegment({ MEDIA_ENV: '../x' } as any)).toBe('x');
  });
  it('tenantMediaKey: <tenantId>/<kind>/<name>; refuses traversal and empty tenant', () => {
    expect(tenantMediaKey('t-1', 'logos', 'a.png')).toBe('t-1/logos/a.png');
    expect(() => tenantMediaKey('', 'logos', 'a.png')).toThrow();
    expect(() => tenantMediaKey('t-1', '..', 'a.png')).toThrow();
    expect(() => tenantMediaKey('t/1', 'logos', 'a.png')).toThrow();
  });
  it('makeMediaStorage puts structured keys under <prefix>/<env>/ and returns a URL that points at that object', async () => {
    const st = makeMediaStorage({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-west-2', MEDIA_S3_PREFIX: 'uploads', MEDIA_ENV: 'staging' } as any, fakeSdk as any);
    const { url } = await st.put(tenantMediaKey('t-1', 'logos', 'a.png'), Buffer.from('x'));
    expect(sent.find((c) => c.type === 'put').input.Key).toBe('uploads/staging/t-1/logos/a.png');
    expect(url).toBe('https://b.s3.us-west-2.amazonaws.com/uploads/staging/t-1/logos/a.png');
  });
  it('the CDN URL carries the env segment too (CDN origin path = the prefix)', async () => {
    const st = makeMediaStorage({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-west-2', MEDIA_S3_PREFIX: 'uploads', MEDIA_ENV: 'production', MEDIA_CDN_BASE_URL: 'https://cdn.x/' } as any, fakeSdk as any);
    expect((await st.put('t-1/logos/a.png', Buffer.from('x'))).url).toBe('https://cdn.x/production/t-1/logos/a.png');
  });
  it('production and staging sharing one bucket can never overwrite each other', async () => {
    const base = { MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-west-2' };
    await makeMediaStorage({ ...base, NODE_ENV: 'production' } as any, fakeSdk as any).put('t/k/a.png', Buffer.from('1'));
    await makeMediaStorage({ ...base, NODE_ENV: 'production', MEDIA_ENV: 'staging' } as any, fakeSdk as any).put('t/k/a.png', Buffer.from('2'));
    const keys = sent.filter((c) => c.type === 'put').map((c) => c.input.Key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('legacy rows and URLs still resolve', () => {
  it('a stored full URL (old bucket, old region) is returned unchanged', () => {
    const legacy = 'https://power-salon-bucket.s3.us-east-2.amazonaws.com/uploads/images/avatar-1.png';
    expect(buildMediaUrl(legacy, { MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'new', AWS_REGION: 'us-west-2' } as any)).toBe(legacy);
  });
  it('a stored bare filename keeps its flat <prefix>/<folder>/<name> layout (no env segment) — where the bytes were written', async () => {
    const env = { MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-west-2', MEDIA_S3_PREFIX: 'uploads', MEDIA_S3_FOLDER_IMAGES: 'images', NODE_ENV: 'production' } as any;
    const st = makeMediaStorage(env, fakeSdk as any);
    const { url } = await st.put('avatar-9.png', Buffer.from('x'));
    expect(sent.find((c) => c.type === 'put').input.Key).toBe('uploads/images/avatar-9.png');
    expect(buildMediaUrl('avatar-9.png', env)).toBe(url);   // writer and reader agree
  });
  it('Phase 12: a structured key (uploadObjectKey) is served from the CURRENT store even when MEDIA_LIVE_IMAGE_BASE is set', () => {
    expect(buildMediaUrl('tenants/t1/avatars/staff/u1/abc.jpg', { MEDIA_LIVE_IMAGE_BASE: 'https://old.example/uploads/images' } as any)).toBe('/media/tenants/t1/avatars/staff/u1/abc.jpg');
  });
  it('MEDIA_LIVE_IMAGE_BASE still serves legacy filenames', () => {
    expect(buildMediaUrl('avatar-1.png', { MEDIA_LIVE_IMAGE_BASE: 'https://old.example/uploads/images' } as any)).toBe('https://old.example/uploads/images/avatar-1.png');
  });
  it('remove(<full URL this store returned>) deletes exactly that object, even one written before the env segment', async () => {
    const st = makeMediaStorage({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-west-2', MEDIA_S3_PREFIX: 'uploads', MEDIA_ENV: 'production' } as any, fakeSdk as any);
    await st.remove('https://b.s3.us-west-2.amazonaws.com/uploads/tenants/t-1/nail-showcase/p/1.jpg');
    expect(sent.find((c) => c.type === 'del').input.Key).toBe('uploads/tenants/t-1/nail-showcase/p/1.jpg');
    sent.length = 0;
    await st.remove('https://elsewhere.example/a.png');            // not ours → no delete
    expect(sent.some((c) => c.type === 'del')).toBe(false);
  });
});

describe('§169 — abandoned uploads are swept', () => {
  it('local disk writes atomically (temp file + rename) and sweepAbandoned removes temp files older than the cutoff only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'media-p11-'));
    const st = new LocalDiskMediaStorage(root);
    await st.put('t-1/a/x.png', Buffer.from('x'));
    expect(readdirSync(join(root, 't-1/a'))).toEqual(['x.png']);             // no temp left behind on success
    mkdirSync(join(root, 't-2'), { recursive: true });
    const oldTmp = join(root, 't-2', 'y.png.tmp-abcdef12'); writeFileSync(oldTmp, 'partial');
    const newTmp = join(root, 't-2', 'z.png.tmp-abcdef34'); writeFileSync(newTmp, 'partial');
    const old = new Date(Date.now() - 25 * 3_600_000); utimesSync(oldTmp, old, old);
    const n = await st.sweepAbandoned(new Date(Date.now() - 24 * 3_600_000));
    expect(n).toBe(1);
    expect(existsSync(oldTmp)).toBe(false);
    expect(existsSync(newTmp)).toBe(true);
    expect(existsSync(join(root, 't-1/a/x.png'))).toBe(true);
  });
  it('S3: aborts incomplete multipart uploads started before the cutoff, under this store’s prefix only', async () => {
    const st = makeMediaStorage({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-west-2', MEDIA_S3_PREFIX: 'uploads' } as any, fakeSdk as any);
    uploads = [
      { Key: 'uploads/development/t/a.png', UploadId: 'old', Initiated: new Date(Date.now() - 48 * 3_600_000) },
      { Key: 'uploads/development/t/b.png', UploadId: 'new', Initiated: new Date() },
    ];
    expect(await st.sweepAbandoned!(new Date(Date.now() - 24 * 3_600_000))).toBe(1);
    expect(sent.find((c) => c.type === 'list').input).toMatchObject({ Bucket: 'b', Prefix: 'uploads/' });
    expect(sent.filter((c) => c.type === 'abort').map((c) => c.input.UploadId)).toEqual(['old']);
  });
});

// B-18 (Oct 22 2026): a legacy avatar kept as a data URL in Postgres renders as itself until the backfill moves it
describe('B-18: buildMediaUrl and legacy data-URL avatars', () => {
  it('returns a data:image URL unchanged — never /media/data:image…', () => {
    const env = { MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'ca-central-1' } as any;
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    expect(buildMediaUrl(data, env)).toBe(data);
    expect(buildMediaUrl(data, {} as any)).toBe(data);
    expect(buildMediaUrl('tenants/t1/avatars/staff/u1/abc.png', {} as any)).toBe('/media/tenants/t1/avatars/staff/u1/abc.png');
  });
});
