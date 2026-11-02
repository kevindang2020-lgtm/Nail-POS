// portfolio-delete-removes-file.pgtest.vitest.spec.ts — Oct 20 2026 (B-27 triage, found by verify-tech-profile).
// Phase 12 moved every technician image to `global/tech-profiles/<profile>/<kind>/…`, and the avatar / cover paths learned
// the new namespace (ownsOurProfileKey) — but deletePhoto and deleteBeforeAfter still only removed keys starting with
// `tech-profiles/<profile>/`. A technician deleting a portfolio photo or a before/after set lost the row while the image
// (possibly a customer's hands) stayed in storage forever. Deleting must remove the stored file — and still never a key
// outside this profile's own namespace.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor, tinyPng, exifJpeg } from '@aipowersalon/testing';
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { TechProfileService } from './tech-profile.service';

const uuid = (p: string, s: string | number) => `${p.padEnd(8, '0')}-0000-4000-8000-${String(s).padStart(12, '0')}`;
const P = 'd4';
const A = uuid(P, 1), BR = uuid(P, 'b1'), MGR = uuid(P, 'f1');
const mgr: any = { tenantId: A, branchId: BR, userId: MGR, role: 'MANAGER', permissions: [] };

/** An in-memory MediaStorage: what put() stored, what remove() deleted. */
function memoryStore() {
  const files = new Map<string, Buffer>();
  const removed: string[] = [];
  return {
    files, removed,
    async put(key: string, body: Buffer) { files.set(key, body); return { url: `/media/${key}` }; },
    async remove(key: string) { removed.push(key); files.delete(key); },
    resolvePath(key: string) { return key.includes('..') ? null : `/mem/${key}`; },
  };
}

let pg: any; let db: any; let store: ReturnType<typeof memoryStore>; let svc: TechProfileService; let me: any; let profileId: string;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  store = memoryStore();
  svc = new TechProfileService(db, store as any, undefined, new GlobalTechIdentityService(db, new GlobalTechDirectory(db)));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','d4-a','D4A','active')`, [A]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [BR, A]);
  await q(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'MANAGER','active','A Mgr')`, [MGR, A, BR]);
  const tech = String((await q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,'Ivy','X','Ivy Delete',true) returning id`, [A, BR]))[0].id);
  const born = await (svc as any).identity.attachToTechnician(mgr, tech, { fullName: 'Ivy Delete', phone: '856-555-7402', email: null });
  profileId = String(born.profileId);
  const [u]: any = await q(`select user_id from technicians where id = $1`, [tech]);
  me = { tenantId: A, branchId: BR, userId: u.user_id, role: 'TECHNICIAN', permissions: [] };
}, 180000);

describe('deleting a technician image removes the stored file (global/tech-profiles namespace)', () => {
  it('deletePhoto removes the portfolio file it uploaded', async () => {
    const added = await svc.addPortfolioPhotos(me, [tinyPng(8, 8)], 'to delete');
    const key = [...store.files.keys()].find((k) => k.includes('/portfolio/'))!;
    expect(key).toMatch(new RegExp(`^global/tech-profiles/${profileId}/portfolio/`));
    await svc.deletePhoto(me, added.photos[0].photoId);
    expect(store.removed).toContain(key);
    expect(store.files.has(key)).toBe(false);
  });

  it('deleteBeforeAfter removes both stored images', async () => {
    const set: any = await svc.createBeforeAfter(me, exifJpeg(64, 48), tinyPng(8, 8), { caption: 'set' });
    const keys = [...store.files.keys()].filter((k) => k.includes('/before-after-'));
    expect(keys).toHaveLength(2);
    await svc.deleteBeforeAfter(me, String(set.setId ?? set.id));
    for (const k of keys) expect(store.files.has(k)).toBe(false);
  });

  it('never removes a key outside this profile\'s own namespace', async () => {
    const added = await svc.addPortfolioPhotos(me, [tinyPng(8, 8)], 'foreign');
    const foreign = `global/tech-profiles/${uuid(P, 'ee')}/portfolio/not-mine.png`;
    await q(`update tech_portfolio_photos set image_url = $1 where id = $2`, [`/media/${foreign}`, added.photos[0].photoId]);
    store.files.set(foreign, Buffer.from('x'));
    await svc.deletePhoto(me, added.photos[0].photoId);
    expect(store.files.has(foreign)).toBe(true);
    expect(store.removed).not.toContain(foreign);
  });
});
