// upload-policy-routes.vitest.spec.ts — BUILD_PLAN Phase 12 (#34): one test per workforce upload route. Each route runs
// the ONE upload policy: the stored bytes have no EXIF / GPS, the key is server-chosen and random (never the client's
// name, never `avatar-<ms>`), and markup posing as an image is refused before anything is stored.
import { describe, it, expect, beforeEach } from 'vitest';
import { exifJpeg, htmlAsImage, EXIF_GPS_MARKER } from '@aipowersalon/testing';
import { StaffAvatarController } from './tech-profile/staff-avatar.controller';
import { TechProfileService } from './tech-profile/tech-profile.service';
import { NailShowcaseCustomerController } from './nail-showcase/nail-showcase.controller';
import { NailShowcaseSocialController } from './nail-showcase/nail-showcase-social.controller';

const T = 'a7000000-0000-4000-8000-000000000001', U = 'a7000000-0000-4000-8000-0000000000c1', P = 'a7000000-0000-4000-8000-0000000000d1';
let puts: Array<{ key: string; body: Buffer }> = [];
const storage = { put: async (key: string, body: Buffer) => { puts.push({ key, body }); return { url: '/media/' + key }; }, remove: async () => undefined, resolvePath: () => null };
beforeEach(() => { puts = []; });
/** A Kysely-shaped chain: every builder method returns the chain; terminals resolve. */
const chainDb = (row: Record<string, unknown> = {}) => {
  const chain: any = new Proxy(function () {} as any, {
    get: (_t, p) => (p === 'then' ? undefined : p === 'executeTakeFirst' || p === 'executeTakeFirstOrThrow' ? async () => row : p === 'execute' ? async () => [] : chain),
    apply: () => chain,
  });
  return chain;
};
const stored = () => Buffer.concat(puts.map((p) => p.body)).toString('latin1');
const file = (buffer: Buffer, originalname = 'photo.jpg', mimetype = 'image/jpeg') => ({ buffer, originalname, mimetype, size: buffer.length });
const req = { ctx: { tenantId: T, branchId: 'b1', userId: U, role: 'TECHNICIAN', permissions: [] } };

describe('POST /auth/avatar (staff)', () => {
  const ctl = () => new StaffAvatarController(chainDb({ avatar_url: null }) as any, storage as any);
  it('stores the picture without its EXIF, under tenants/<salon>/avatars/staff/<user>/<random>', async () => {
    const r = await ctl().uploadAvatar(req, file(exifJpeg()));
    expect(r.ok).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toMatch(new RegExp(`^tenants/${T}/avatars/staff/${U}/[0-9a-f]{24}\\.jpg$`));
    expect(stored()).not.toContain(EXIF_GPS_MARKER);
  });
  it('refuses markup posing as an image and stores nothing', async () => {
    await expect(ctl().uploadAvatar(req, file(htmlAsImage()))).rejects.toThrow();
    expect(puts).toHaveLength(0);
  });
});

describe('technician profile: POST /tech/profile/avatar | cover | photos | before-after', () => {
  const svc = () => {
    const s: any = new TechProfileService(chainDb({ id: 'row-1', image_url: '/media/x', sort_order: 0, m: -1, avatar_url: null, cover_url: null }) as any, storage as any);
    s.myProfileId = async () => P; s.loadProfile = async () => ({}); s.shape = async () => ({ ok: true }); s.audit = async () => undefined; s.myTechnician = async () => ({ id: 't1' });
    return s as TechProfileService;
  };
  const ctx = { tenantId: T, branchId: 'b1', userId: U, role: 'TECHNICIAN', permissions: [] } as any;
  it('avatar: stripped, under global/tech-profiles/<profile>/avatar/<random> (was `avatar-<ms>`, shared by every technician)', async () => {
    await svc().uploadAvatar(ctx, exifJpeg());
    expect(puts[0].key).toMatch(new RegExp(`^global/tech-profiles/${P}/avatar/[0-9a-f]{24}\\.jpg$`));
    expect(stored()).not.toContain(EXIF_GPS_MARKER);
  });
  it('cover: stripped, random key', async () => {
    await svc().uploadCover(ctx, exifJpeg());
    expect(puts[0].key).toMatch(new RegExp(`^global/tech-profiles/${P}/cover/[0-9a-f]{24}\\.jpg$`));
    expect(stored()).not.toContain(EXIF_GPS_MARKER);
  });
  it('portfolio photos: every file stripped', async () => {
    await svc().addPortfolioPhotos(ctx, [exifJpeg(), exifJpeg(80, 60)]);
    expect(puts.map((p) => p.key).every((k) => k.startsWith(`global/tech-profiles/${P}/portfolio/`))).toBe(true);
    expect(puts).toHaveLength(2);
    expect(stored()).not.toContain(EXIF_GPS_MARKER);
  });
  it('before / after: both stripped; markup refused', async () => {
    await svc().createBeforeAfter(ctx, exifJpeg(), exifJpeg(), {});
    expect(puts.map((p) => p.key.split('/')[3])).toEqual(['before-after-before', 'before-after-after']);
    expect(stored()).not.toContain(EXIF_GPS_MARKER);
    puts = [];
    await expect(svc().createBeforeAfter(ctx, htmlAsImage(), exifJpeg(), {})).rejects.toThrow();
    expect(puts).toHaveLength(0);
  });
});

describe('customer nail showcase: POST /customer/nail-showcase/posts/:postId/photos', () => {
  it('a customer phone photo on the PUBLIC feed loses its EXIF / GPS; the key is under the salon, never the client name', async () => {
    let descriptors: any[] = [];
    const ctl = new NailShowcaseCustomerController({ addPhotosToPost: async (_c: any, _p: string, d: any[]) => { descriptors = d; return { ok: true }; } } as any, storage as any);
    await ctl.addPhotos({ ctx: { ...req.ctx, role: 'CUSTOMER' } }, P, [file(exifJpeg(), '../../etc/passwd.jpg')], {});
    expect(puts[0].key).toMatch(new RegExp(`^tenants/${T}/nail-showcase/b1/${U}/${P}/[0-9a-f]{24}\\.jpg$`));
    expect(stored()).not.toContain(EXIF_GPS_MARKER);
    expect(descriptors[0].imageUrl).toBe('/media/' + puts[0].key);
  });
});

describe('customer social profile: POST /customer/social/me/avatar', () => {
  it('stripped and random under the salon; a video is not an avatar', async () => {
    let setTo = '';
    const ctl = new NailShowcaseSocialController({ setAvatar: async (_c: any, k: string) => { setTo = k; return { ok: true }; } } as any, {} as any, storage as any);
    await ctl.avatar({ ctx: { ...req.ctx, role: 'CUSTOMER' } }, [file(exifJpeg())], {});
    expect(setTo).toMatch(new RegExp(`^tenants/${T}/social-avatars/customer/${U}/[0-9a-f]{24}\\.jpg$`));
    expect(stored()).not.toContain(EXIF_GPS_MARKER);
  });
});
