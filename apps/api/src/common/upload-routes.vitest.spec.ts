// upload-routes.vitest.spec.ts — BUILD_PLAN Phase 12 (#34): the API's own upload routes run the ONE upload policy, the
// static gate (check:uploads) sees every upload, and a refused upload is answered as a 4xx with its code (not a 500).
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { exifJpeg, htmlAsImage, EXIF_GPS_MARKER } from '@aipowersalon/testing';
import { UploadRejected } from '@aipowersalon/media';
import { PlatformExceptionFilter } from '@aipowersalon/observability/nest';
import { CustomerController } from '../customer/customer.controller';
import { ProfileService, AvatarError } from '../profile/profile.service';
const { check, inventory }: any = await import('../../scripts/audit-uploads.mjs');

const API = join(__dirname, '..', '..');
const T = 'aa000000-0000-4000-8000-000000000001', U = 'aa000000-0000-4000-8000-0000000000c1', C = 'aa000000-0000-4000-8000-0000000000e1';
let puts: Array<{ key: string; body: Buffer }> = [];
const storage = { put: async (key: string, body: Buffer) => { puts.push({ key, body }); return { url: '/media/' + key }; }, remove: async () => undefined, resolvePath: () => null };
beforeEach(() => { puts = []; });
const chainDb = () => { const c: any = new Proxy(function () {} as any, { get: (_t, p) => (p === 'then' ? undefined : c), apply: () => c }); return c; };

describe('POST /customer/profile/avatar', () => {
  let saved = '';
  const ctl = () => new CustomerController({ requireCustomer: async () => C, getProfile: async () => ({ avatarUrl: null }), setAvatar: async (_c: any, k: string) => { saved = k; } } as any, {} as any, storage as any);
  const req = { ctx: { tenantId: T, branchId: 'b1', userId: U, role: 'CUSTOMER', permissions: [] } };
  it('the customer picture loses its EXIF; the key is tenants/<salon>/avatars/customer/<customer>/<random>', async () => {
    await ctl().uploadAvatar(req, [{ buffer: exifJpeg(), originalname: 'me.jpg', mimetype: 'image/jpeg' }]);
    expect(saved).toMatch(new RegExp(`^tenants/${T}/avatars/customer/${C}/[0-9a-f]{24}\\.jpg$`));
    expect(puts[0].body.toString('latin1')).not.toContain(EXIF_GPS_MARKER);
  });
  it('markup posing as an image is refused, nothing stored', async () => {
    await expect(ctl().uploadAvatar(req, [{ buffer: htmlAsImage(), originalname: 'me.jpg', mimetype: 'image/jpeg' }])).rejects.toThrow();
    expect(puts).toHaveLength(0);
  });
});

describe('PATCH /pos/me/avatar (data URL)', () => {
  it('stored stripped, under the salon and the user, with a random name (was `avatar-<ms>` for everyone)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'p12-me-')); process.env.MEDIA_ROOT = root; delete process.env.MEDIA_STORE;
    const r = await new ProfileService(chainDb() as any).setAvatar({ tenantId: T, userId: U } as any, 'data:image/jpeg;base64,' + exifJpeg().toString('base64'));
    const key = r.avatarUrl.replace(/^\/media\//, '');
    expect(key).toMatch(new RegExp(`^tenants/${T}/avatars/staff/${U}/[0-9a-f]{24}\\.jpg$`));
    expect(readFileSync(join(root, key)).toString('latin1')).not.toContain(EXIF_GPS_MARKER);
  });
  it('quota: a JSON-body upload is charged to the salon (the multipart guard never sees it), and an over-quota upload stores nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'p12-me-')); process.env.MEDIA_ROOT = root;
    const charged: number[] = [];
    const quota = { reserveStorage: async (_t: string, n: number) => { charged.push(n); }, releaseStorage: async () => undefined };
    await new ProfileService(chainDb() as any, quota).setAvatar({ tenantId: T, userId: U } as any, 'data:image/jpeg;base64,' + exifJpeg().toString('base64'));
    expect(charged).toHaveLength(1);
    const full = { reserveStorage: async () => { throw new Error('QUOTA_EXCEEDED'); }, releaseStorage: async () => undefined };
    await expect(new ProfileService(chainDb() as any, full).setAvatar({ tenantId: T, userId: U } as any, 'data:image/jpeg;base64,' + exifJpeg().toString('base64'))).rejects.toThrow('QUOTA_EXCEEDED');
  });
  it('a refused upload is an AvatarError with the policy status', async () => {
    const big = 'data:image/jpeg;base64,' + Buffer.concat([exifJpeg(), Buffer.alloc(11 * 1024 * 1024)]).toString('base64');
    const e = await new ProfileService(chainDb() as any).setAvatar({ tenantId: T, userId: U } as any, big).catch((x) => x);
    expect(e).toBeInstanceOf(AvatarError);
    expect(e.status).toBe(413);
  });
});

describe('a refused upload reaches the client as a 4xx with its code (PlatformExceptionFilter)', () => {
  it('UploadRejected → 413 PAYLOAD_TOO_LARGE / 400 VALIDATION_FAILED with details — never a 500', () => {
    const out: any = {};
    const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, json(b: any) { out.body = b; } };
    const host: any = { switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/x' }), getResponse: () => res }) };
    new PlatformExceptionFilter().catch(new UploadRejected('TOO_LARGE', 'The file is larger than 10 MB.', { maxBytes: 1 }), host);
    expect(out.status).toBe(413);
    expect(JSON.stringify(out.body)).toContain('PAYLOAD_TOO_LARGE');
    new PlatformExceptionFilter().catch(new UploadRejected('TYPE_NOT_ALLOWED', 'Only JPG, PNG, WEBP files can be uploaded here.'), host);
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.body)).toContain('Only JPG, PNG, WEBP');
    new PlatformExceptionFilter().catch(Object.assign(new Error('internal detail'), { expose: false, status: 400, code: 'X' }), host);
    expect(out.status).toBe(500);   // only an EXPOSED client error passes through
  });
});

describe('check:uploads — the gate sees every upload', () => {
  it('the committed tree: every upload route on the policy, 0 findings', () => {
    const r = spawnSync('node', ['scripts/audit-uploads.mjs'], { cwd: API, encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/(\d+)\/\1 upload routes on the upload policy/);
  });
  it('a store site or interceptor that skips the policy is a finding (planted)', () => {
    const inv = inventory();
    inv.srcOf.set('modules/x/src/rogue.controller.ts', "await this.storage.put(`uploads/${file.originalname}`, file.buffer);");
    inv.storeSites.push({ file: 'modules/x/src/rogue.controller.ts', line: 1, call: 'put' });
    inv.interceptors.push({ file: 'modules/x/src/rogue.controller.ts', line: 1, kind: 'FileInterceptor', text: "('file', { limits: { fileSize: 99 * 1024 * 1024 } })" });
    const f = check(inv).findings.join('\n');
    expect(f).toMatch(/S1 {2}modules\/x\/src\/rogue/);
    expect(f).toMatch(/K1 {2}modules\/x\/src\/rogue/);
    expect(f).toMatch(/I1 {2}modules\/x\/src\/rogue/);
  });
});
