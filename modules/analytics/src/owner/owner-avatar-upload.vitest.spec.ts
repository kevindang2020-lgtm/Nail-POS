// owner-avatar-upload.vitest.spec.ts — BUILD_PLAN Phase 12 (#34): POST /owner/profile/avatar runs the upload policy — the
// public picture loses its EXIF, the key is tenants/<salon>/avatars/owner/<user>/<random>, markup is refused.
import { describe, it, expect, beforeEach } from 'vitest';
import { exifJpeg, htmlAsImage, EXIF_GPS_MARKER } from '@aipowersalon/testing';
import { OwnerController } from './owner.controller';

const T = 'a9000000-0000-4000-8000-000000000001', U = 'a9000000-0000-4000-8000-0000000000c1';
let puts: Array<{ key: string; body: Buffer }> = []; let saved = '';
const storage = { put: async (key: string, body: Buffer) => { puts.push({ key, body }); return { url: '/media/' + key }; }, remove: async () => undefined, resolvePath: () => null };
const svc = { getProfileCard: async () => ({ avatarUrl: null }), setAvatar: async (_c: any, k: string) => { saved = k; } };
const ctl = () => new OwnerController(svc as any, {} as any, {} as any, {} as any, storage as any);
const req = { ctx: { tenantId: T, branchId: 'b1', userId: U, role: 'OWNER', permissions: ['owner.dashboard.view'] } };
beforeEach(() => { puts = []; saved = ''; });

describe('POST /owner/profile/avatar', () => {
  it('stores the picture without its EXIF under the salon, with a random name', async () => {
    await ctl().uploadAvatar(req, [{ buffer: exifJpeg(), originalname: 'me.jpg', mimetype: 'image/jpeg' }]);
    expect(saved).toMatch(new RegExp(`^tenants/${T}/avatars/owner/${U}/[0-9a-f]{24}\\.jpg$`));
    expect(puts[0].body.toString('latin1')).not.toContain(EXIF_GPS_MARKER);
  });
  it('refuses markup posing as an image', async () => {
    await expect(ctl().uploadAvatar(req, [{ buffer: htmlAsImage(), originalname: 'me.jpg', mimetype: 'image/jpeg' }])).rejects.toThrow();
    expect(puts).toHaveLength(0);
  });
});
