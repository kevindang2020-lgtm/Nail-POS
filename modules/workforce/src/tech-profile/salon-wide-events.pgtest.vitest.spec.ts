// salon-wide-events.pgtest — B-14 (Oct 20 2026): two tech-profile facts that concern a whole SALON used to reach it only by
// a hand-rolled push to each of its branch rooms (emitTenantWide): a technician's request to join / transfer to it, and a
// public-profile edit it must review. Both are domain events now — on THAT salon's envelope, with its branch ids, committed
// with the write they belong to — and the realtime projection's salon scope delivers them.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { GlobalTechIdentityService } from './global-tech-identity.service';
import { GlobalTechDirectory } from './global-tech-directory.kysely';
import { TechProfileService } from './tech-profile.service';

const uuid = (p: string, s: string | number) => `${p.padEnd(8, '0')}-0000-4000-8000-${String(s).padStart(12, '0')}`;
const P = 'c7';
const A = uuid(P, 1), B = uuid(P, 2);
const BR_A = uuid(P, 'b1'), BR_B1 = uuid(P, 'b2'), BR_B2 = uuid(P, 'b3');
const MGR_A = uuid(P, 'f1'), MGR_B = uuid(P, 'f2');
const mgrA: any = { tenantId: A, branchId: BR_A, userId: MGR_A, role: 'MANAGER', permissions: [] };
let pg: any; let db: any; let identity: GlobalTechIdentityService; let profiles: TechProfileService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const events = (tenantId: string, type: string) => q(`select aggregate_type, aggregate_id, actor_id, payload_json from outbox_events where tenant_id = $1 and event_type = $2 order by created_at`, [tenantId, type]);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  identity = new GlobalTechIdentityService(db as any, new GlobalTechDirectory(db as any));
  profiles = new TechProfileService(db as any, null as any, undefined, identity, new OutboxWriter());
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','c7-a','C7A','active'),($2,'B','Salon B','c7-b','C7B','active')`, [A, B]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'),($3,$4,'B one','active'),($5,$6,'B two','active')`, [BR_A, A, BR_B1, B, BR_B2, B]);
  await q(`insert into tenant_app_flags (tenant_id, flag_key, enabled) values ($1,'public_listing',true),($2,'public_listing',true)`, [A, B]);
  await q(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'MANAGER','active','A Mgr'),($4,$5,$6,'MANAGER','active','B Mgr')`, [MGR_A, A, BR_A, MGR_B, B, BR_B1]);
}, 180000);

describe('B-14: salon-wide tech-profile facts are recorded domain events', () => {
  it('a membership request is technician.membership_requested on the salon ASKED, naming its branches, committed with the request row', async () => {
    const tech = String((await q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,'Mia','X','Mia X',true) returning id`, [A, BR_A]))[0].id);
    const born = await identity.attachToTechnician(mgrA, tech, { fullName: 'Mia X', phone: '856-555-7001', email: null });
    const [u]: any = await q(`select user_id from technicians where id = $1`, [tech]);
    const me: any = { tenantId: A, branchId: BR_A, userId: u.user_id, role: 'TECHNICIAN', permissions: [] };
    const req: any = await profiles.requestMembership(me, 'C7B', 'hello', { transfer: true });
    expect(req.status).toBe('pending_salon_approval');
    const [m]: any = await q(`select id from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [born.profileId, B]);
    const ev = await events(B, 'technician.membership_requested');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregate_type: 'tech_salon_membership', aggregate_id: m.id, actor_id: u.user_id });
    expect(ev[0].payload_json).toMatchObject({ profileId: born.profileId, transfer: true });
    expect([...ev[0].payload_json.branchIds].sort()).toEqual([BR_B1, BR_B2].sort());   // every room of salon B
    expect(await events(A, 'technician.membership_requested')).toEqual([]);              // nothing on the salon she is leaving (§61)
  });
  it('a held public-profile edit is technician.profile_change_held on each reviewing salon', async () => {
    const tech = String((await q(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$2,'Ann','X','Ann X',true) returning id`, [A, BR_A]))[0].id);
    const born = await identity.attachToTechnician(mgrA, tech, { fullName: 'Ann X', phone: '856-555-7002', email: null });
    const [u]: any = await q(`select user_id from technicians where id = $1`, [tech]);
    const me: any = { tenantId: A, branchId: BR_A, userId: u.user_id, role: 'TECHNICIAN', permissions: [] };
    await profiles.posSetProfilePolicy(mgrA, true);
    const held: any = await profiles.updateMyProfile(me, { bio: 'NEW BIO' });
    expect(held.pendingChanges?.changes).toEqual({ bio: 'NEW BIO' });
    const ev = await events(A, 'technician.profile_change_held');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregate_type: 'technician_profile_change', aggregate_id: held.pendingChanges.requestId, actor_id: u.user_id });
    expect(ev[0].payload_json).toMatchObject({ profileId: born.profileId, held: true, branchIds: [BR_A] });
  });
});
