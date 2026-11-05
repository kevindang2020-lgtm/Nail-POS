// media-access.pgtest.vitest.spec.ts — /media/* is no longer a public dump of every stored key (Technician Profile merge,
// mandate §93/§117–§118). Adapted to our migratedPglite harness and OUR key layout (global/tech-profiles/…, tenants/…/skill-docs/…).
//
// Real schema (PGlite), real LocalDiskMediaStorage in a temp dir, the real MediaController decision. Public photo
// served; private / rejected photo, unpublished before-after set and a skill document refused without a valid signed
// URL; a signed URL works and then EXPIRES; a hidden profile's "public" photo is not public; a session cookie of the
// owning technician / a manager of a salon she is active at / a super admin is accepted, a stranger's is not.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { LocalDiskMediaStorage } from '@aipowersalon/media';
import { MediaAccessService } from './media-access.service';
import { MediaController } from './media.controller';
import { signMediaUrl, mediaSignKey, classifyMediaKey, verifyMediaSignature, validateSkillDocumentUpload } from './media-access-core';
import { signSession } from '@aipowersalon/identity';

const uuid = (p: string, n: string | number) => `${p}${'0'.repeat(8 - p.length)}-0000-4000-8000-${String(n).replace(/[^0-9a-f]/g, '').padStart(12, '0')}`;

const SECRET = 'media-test-secret-0123456789';
const P = 'ea';
const TA = uuid(P, 1), TB = uuid(P, 2), TC = uuid(P, 3);
const BA = uuid(P, 'b1');
const GTP = uuid(P, 'a1'), GTP_HIDDEN = uuid(P, 'a2');
const OWNER_USER = uuid(P, 'f1'), MGR_A = uuid(P, 'f2'), MGR_C = uuid(P, 'f3'), SA = uuid(P, 'f4');
const TECH_ROW = uuid(P, 'd1');

const K_PUBLIC = `global/tech-profiles/${GTP}/portfolio/public.jpg`;
const K_PRIVATE = `global/tech-profiles/${GTP}/portfolio/private.jpg`;
const K_REJECTED = `global/tech-profiles/${GTP}/portfolio/rejected.jpg`;
const K_BA = `global/tech-profiles/${GTP}/before/1-before.jpg`;
const K_SKILLDOC = `tenants/${TA}/skill-docs/${OWNER_USER}/licence.pdf`;   // OUR layout: the login id in the path
const K_SKILLDOC_THEIRS = `skilldoc/${TA}/${GTP}/licence.pdf`;
const K_HIDDEN_PUBLIC = `global/tech-profiles/${GTP_HIDDEN}/portfolio/public.jpg`;
const K_OTHER = `avatar-1700000000000.png`; // a legacy user avatar no private table references

let pg: any; let db: any;
const h = { q: (sql: string, p: any[] = []) => pg.query(sql, p).then((r: any) => r.rows) };
let root: string;
let ctl: MediaController;

const cookie = (userId: string, tenantId: string | null, role: any, name = 'aps_session') =>
  ({ cookie: `${name}=${signSession({ userId, tenantId, branchId: null, role, permissions: [], subscriptionStatus: 'active' } as any, { secret: SECRET })}` });

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  pg = await migratedPglite(); db = kyselyFor(pg);
  root = mkdtempSync(join(tmpdir(), 'aps-media-'));
  for (const k of [K_PUBLIC, K_PRIVATE, K_REJECTED, K_BA, K_SKILLDOC, K_SKILLDOC_THEIRS, K_HIDDEN_PUBLIC, K_OTHER]) {
    mkdirSync(dirname(join(root, k)), { recursive: true });
    writeFileSync(join(root, k), Buffer.from('x'));
  }
  ctl = new MediaController(new LocalDiskMediaStorage(root), new MediaAccessService(db as any));

  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','Salon A','ma-a','MAA'),($2,'B','Salon B','ma-b','MAB'),($3,'C','Salon C','ma-c','MAC')`, [TA, TB, TC]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [BA, TA]);
  await h.q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, is_public, status) values ($1,'MA1','ma-one','Ma One',true,'active'),($2,'MA2','ma-two','Ma Two',true,'active')`, [GTP, GTP_HIDDEN]);
  await h.q(`update global_tech_profiles set admin_profile_hidden = true where id = $1`, [GTP_HIDDEN]);
  await h.q(`insert into users (id, tenant_id, branch_id, full_name, email, status, role, mfa_enabled, must_change_password) values
    ($1,$5,$6,'Owner','own@ma.test','active','TECHNICIAN',false,false),($2,$5,$6,'Mgr A','mgra@ma.test','active','MANAGER',false,false),
    ($3,$7,null,'Mgr C','mgrc@ma.test','active','MANAGER',false,false),($4,null,null,'SA','sa@ma.test','active','SUPER_ADMIN',false,false)`, [OWNER_USER, MGR_A, MGR_C, SA, TA, BA, TC]);
  await h.q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, global_tech_profile_id) values ($1,$2,$3,$4,'Ma','One','Ma One',true,$5)`, [TECH_ROW, TA, BA, OWNER_USER, GTP]);
  await h.q(`update users set global_tech_profile_id = $1 where id = $2`, [GTP, OWNER_USER]);
  await h.q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, technician_id, status) values ($1,$2,$3,$4,'active')`, [GTP, TA, BA, TECH_ROW]);
  await h.q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, status) values ($1,$2,null,'former')`, [GTP, TC]);
  await h.q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, thumbnail_url, moderation_status, is_public) values
    ($1,$2,$2,'approved',true),($1,$3,$3,'approved',false),($1,$4,$4,'rejected',true),($5,$6,$6,'approved',true)`,
    [GTP, `/media/${K_PUBLIC}`, `/media/${K_PRIVATE}`, `/media/${K_REJECTED}`, GTP_HIDDEN, `/media/${K_HIDDEN_PUBLIC}`]);
  await h.q(`insert into before_after_sets (global_tech_profile_id, before_image_url, after_image_url, is_public, moderation_status) values ($1,$2,$2,false,'approved')`, [GTP, `/media/${K_BA}`]);
});
afterAll(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('/media/* — public vs private', () => {
  it('a public + approved portfolio photo of a visible profile is served openly (cacheable)', async () => {
    expect(await ctl.decide(K_PUBLIC, {}, {})).toBe('public');
  });
  it('a key no private table references keeps today\'s behaviour (user avatars stay loadable)', async () => {
    expect(await ctl.decide(K_OTHER, {}, {})).toBe('public');
  });
  it('a private photo, a rejected photo, an unpublished before/after and a skill document are REFUSED anonymously', async () => {
    for (const k of [K_PRIVATE, K_REJECTED, K_BA, K_SKILLDOC, K_SKILLDOC_THEIRS]) expect(await ctl.decide(k, {}, {}), k).toBeNull();
  });
  it('a hidden (super-admin) profile\'s photo is not public even though the row says is_public + approved', async () => {
    expect(await ctl.decide(K_HIDDEN_PUBLIC, {}, {})).toBeNull();
  });
});

describe('/media/* — signed URLs', () => {
  const key = () => mediaSignKey(SECRET);
  const parse = (url: string) => { const u = new URL(url, 'http://x'); return { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') }; };

  it('a valid short-lived signed URL serves the private object (no cache)', async () => {
    const url = signMediaUrl(K_PRIVATE, { signKey: key(), ttlSeconds: 60 })!;
    expect(url.startsWith(`/media/${K_PRIVATE}?exp=`)).toBe(true);
    expect(await ctl.decide(K_PRIVATE, parse(url), {})).toBe('private');
    const doc = signMediaUrl(K_SKILLDOC, { signKey: key(), ttlSeconds: 60 })!;
    expect(await ctl.decide(K_SKILLDOC, parse(doc), {})).toBe('private');
  });
  it('the signature EXPIRES, is bound to the key, and a tampered signature fails', async () => {
    const now = Math.floor(Date.now() / 1000);
    const stale = signMediaUrl(K_PRIVATE, { signKey: key(), now: now - 3600, ttlSeconds: 60 })!;
    expect(await ctl.decide(K_PRIVATE, parse(stale), {})).toBeNull();
    const forOther = signMediaUrl(K_PUBLIC, { signKey: key(), ttlSeconds: 60 })!;
    expect(await ctl.decide(K_PRIVATE, parse(forOther), {})).toBeNull();           // signed for a different key
    const q = parse(signMediaUrl(K_PRIVATE, { signKey: key(), ttlSeconds: 60 })!);
    expect(await ctl.decide(K_PRIVATE, { exp: q.exp, sig: q.sig!.slice(0, -2) + 'AA' }, {})).toBeNull();
    expect(verifyMediaSignature(K_PRIVATE, q.exp, q.sig, { signKey: null })).toBe(false); // no key → fail closed
  });
});

describe('/media/* — authorized sessions', () => {
  it('the owning technician\'s session cookie reads her private photo and her skill document', async () => {
    const hdr = cookie(OWNER_USER, TA, 'TECHNICIAN');
    expect(await ctl.decide(K_PRIVATE, {}, hdr)).toBe('private');
    expect(await ctl.decide(K_SKILLDOC, {}, hdr)).toBe('private');
    expect(await ctl.decide(K_SKILLDOC_THEIRS, {}, hdr)).toBe('private');
  });
  it('a manager of a salon where she is ACTIVE may read; a manager of a salon she LEFT may not; a super admin may', async () => {
    expect(await ctl.decide(K_PRIVATE, {}, cookie(MGR_A, TA, 'MANAGER'))).toBe('private');
    expect(await ctl.decide(K_PRIVATE, {}, cookie(MGR_C, TC, 'MANAGER'))).toBeNull();
    expect(await ctl.decide(K_PRIVATE, {}, cookie(SA, null, 'SUPER_ADMIN', 'aps_platform'))).toBe('private');   // platform realm cookie
  });
  it('a forged cookie (wrong secret) is just an anonymous request', async () => {
    const bad = `aps_session=${signSession({ userId: OWNER_USER, tenantId: TA, branchId: null, role: 'TECHNICIAN', permissions: [], subscriptionStatus: 'active' } as any, { secret: 'not-the-secret' })}`;
    expect(await ctl.decide(K_PRIVATE, {}, { cookie: bad })).toBeNull();
  });
});

describe('media keys + skill-document validation (pure)', () => {
  it('classifies the namespaces the rules depend on', () => {
    expect(classifyMediaKey(K_SKILLDOC)).toBe('skilldoc');
    expect(classifyMediaKey(K_SKILLDOC_THEIRS)).toBe('skilldoc');
    expect(classifyMediaKey(`global/tech-profiles/${GTP}/avatar/x.png`)).toBe('avatar');
    expect(classifyMediaKey(`global/tech-profiles/${GTP}/cover/x.png`)).toBe('cover');
    expect(classifyMediaKey('skill-docs/legacy.pdf')).toBe('skilldoc');
    expect(classifyMediaKey(`/media/${K_PUBLIC}`)).toBe('portfolio');
    expect(classifyMediaKey(K_BA)).toBe('before_after');
    expect(classifyMediaKey(`avatar/${GTP}/x.png`)).toBe('avatar');
    expect(classifyMediaKey(K_OTHER)).toBe('avatar');
    expect(classifyMediaKey('tenants/t/branches/b/customers/u/nail-showcase/p/1.jpg')).toBe('showcase');
    expect(classifyMediaKey('something/else.bin')).toBe('other');
  });
  it('skill documents are accepted by MAGIC BYTES only: pdf/png/jpg/webp pass, anything else is refused whatever it is called', () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32)]);
    expect(validateSkillDocumentUpload(pdf)).toMatchObject({ ok: true, ext: 'pdf' });
    expect(validateSkillDocumentUpload(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]))).toMatchObject({ ok: true, ext: 'jpg' });
    expect(validateSkillDocumentUpload(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)])).ok).toBe(false);  // an .exe named licence.pdf
    expect(validateSkillDocumentUpload(Buffer.from('<html><script>')).ok).toBe(false);
    expect(validateSkillDocumentUpload(Buffer.alloc(0)).ok).toBe(false);
    expect(validateSkillDocumentUpload(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024 + 1)])).ok).toBe(false);
  });
});
