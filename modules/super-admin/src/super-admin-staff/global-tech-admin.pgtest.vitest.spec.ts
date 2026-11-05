// global-tech-admin.pgtest.vitest.spec.ts — merge, erasure, and a transfer that actually moves somebody.
//
// All three are irreversible or close to it, and all three used to be either absent or a status flip. So they are
// tested against a REAL Postgres engine, with the real services, and the assertions are about what is IN the
// database afterwards — not about what a mock was called with.
import { GlobalTechIdentityService, GlobalTechDirectory } from '@aipowersalon/workforce';
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { GlobalTechAdminService, GlobalTechAdminError } from './global-tech-admin.service';
import { KyselyCrossTenantTransferExecutor } from './cross-tenant-transfer.executor';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';   // Luxe Nails
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';   // Belle Palace
const BR_A = 'a1111111-1111-1111-1111-111111111111';
const BR_B = 'b1111111-1111-1111-1111-111111111111';
const ADMIN = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

let pg: PGlite;
let db: any;
let admin: GlobalTechAdminService;
let identity: GlobalTechIdentityService;
let executor: KyselyCrossTenantTransferExecutor;

const ctx = { userId: ADMIN, ip: undefined };
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    if (f.startsWith('378')) await pg.exec(s);          // the new migration is NOT tolerant
    else try { await pg.exec(s); } catch { /* pg_trgm / btree_gist */ }
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  admin = new GlobalTechAdminService(db);
  identity = new GlobalTechIdentityService(db, new GlobalTechDirectory(db));
  executor = new KyselyCrossTenantTransferExecutor(db, identity);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values
             ($1,'Luxe','Luxe Nails','luxe','LUXE','active'), ($2,'Belle','Belle Palace','belle','BELLE','active')`, [A, B]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Main','active')`, [BR_A, A, BR_B, B]);
  // The admin performing irreversible ops holds an active elevated (security_admin) grant — the second factor.
  await q(`insert into privileged_access_grants (grant_ref, user_id, privilege, scope, reason, status, expires_at) values ('seed-elev-admin', $1, 'security_admin', 'platform', 'test elevation', 'active', now() + interval '1 day')`, [ADMIN]);
}, 180000);

/** One technician with a global account, employed at `tenant`. */
async function makeTech(code: string, name: string, tenant: string, branch: string, phone: string | null) {
  const p: any = (await q(
    `insert into global_tech_profiles (tech_code, public_slug, display_name, normalized_phone, phone_hash)
     values ($1,$2,$3,$4,$5) returning id`, [code, `${code.toLowerCase()}-slug`, name, phone, phone ? `h${phone}` : null]))[0];
  const u: any = (await q(
    `insert into users (tenant_id, branch_id, role, status, full_name, global_tech_profile_id)
     values ($1,$2,'TECHNICIAN','active',$3,$4) returning id`, [tenant, branch, name, p.id]))[0];
  const t: any = (await q(
    `insert into technicians (tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, global_tech_profile_id)
     values ($1,$2,$3,$4,'X',$5,true,$6) returning id`, [tenant, branch, u.id, name, name, p.id]))[0];
  const m: any = (await q(
    `insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, technician_id, user_id, status, start_date)
     values ($1,$2,$3,$4,$5,'active',now()) returning id`, [p.id, tenant, branch, t.id, u.id]))[0];
  return { profileId: p.id as string, userId: u.id as string, technicianId: t.id as string, membershipId: m.id as string };
}

describe('MERGE — one human, two accounts', () => {
  it('absorbs the duplicate: employment, logins, rosters, portfolio, ratings and followers all follow her', async () => {
    // The ordinary duplicate: Luxe created her with a phone, Belle with none — the keys never matched.
    const keep = await makeTech('TECH-100001', 'Olivia Brown', A, BR_A, '+18565551234');
    const dupe = await makeTech('TECH-100002', 'Olivia Brown', B, BR_B, null);
    await q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, moderation_status, is_public) values ($1,'x.jpg','approved',true)`, [dupe.profileId]);

    const r = await admin.merge(ctx, keep.profileId, dupe.profileId, 'Same person — matched by support.');
    expect(r.ok).toBe(true);

    // everything moved
    expect((await q(`select count(*)::int n from technicians where global_tech_profile_id = $1`, [keep.profileId]))[0].n).toBe(2);
    expect((await q(`select count(*)::int n from users where global_tech_profile_id = $1`, [keep.profileId]))[0].n).toBe(2);
    expect((await q(`select count(*)::int n from tech_salon_memberships where global_tech_profile_id = $1`, [keep.profileId]))[0].n).toBe(2);
    expect((await q(`select count(*)::int n from tech_portfolio_photos where global_tech_profile_id = $1`, [keep.profileId]))[0].n).toBe(1);
    // and nothing was left behind
    expect((await q(`select count(*)::int n from technicians where global_tech_profile_id = $1`, [dupe.profileId]))[0].n).toBe(0);
  });

  it('the losing profile is a SIGNPOST, not a deletion — and it keeps its tech_code forever', async () => {
    const [d]: any = await q(`select status, merged_into_profile_id, tech_code, phone_hash from global_tech_profiles where tech_code = 'TECH-100002'`);
    expect(d.status).toBe('merged');
    expect(d.merged_into_profile_id).toBeTruthy();
    expect(d.tech_code).toBe('TECH-100002');   // never reused
    expect(d.phone_hash).toBeNull();           // keys released

    // and the code cannot be handed to anybody else
    await expect(pg.query(`insert into global_tech_profiles (tech_code, public_slug, display_name) values ('TECH-100002','z','Z')`)).rejects.toThrow();
  });

  it('REFUSES when both accounts are on the roster at the SAME salon', async () => {
    // Two technicians rows for one person at one salon. Merging would pick a winner between two payroll
    // histories, and the platform cannot know which roster row is real.
    const one = await makeTech('TECH-100003', 'Ana Lee', A, BR_A, '+18565559001');
    const two = await makeTech('TECH-100004', 'Ana Lee', A, BR_A, '+18565559002');
    await expect(admin.merge(ctx, one.profileId, two.profileId, 'dupe')).rejects.toThrow(GlobalTechAdminError);
    await expect(admin.merge(ctx, one.profileId, two.profileId, 'dupe')).rejects.toThrow(/same salon/i);
    // and nothing moved
    expect((await q(`select global_tech_profile_id from technicians where id = $1`, [two.technicianId]))[0].global_tech_profile_id).toBe(two.profileId);
  });

  it('a merge with no reason is refused. It cannot be undone.', async () => {
    const x = await makeTech('TECH-100005', 'Kim P', A, BR_A, '+18565559003');
    const y = await makeTech('TECH-100006', 'Kim P', B, BR_B, '+18565559004');
    await expect(admin.merge(ctx, x.profileId, y.profileId, '   ')).rejects.toThrow(/reason/i);
  });
});

describe('ANONYMIZE — erasure is a workflow, not a button', () => {
  it('refuses without a request', async () => {
    const t = await makeTech('TECH-200001', 'Mia R', A, BR_A, '+18565552001');
    await expect(admin.anonymize(ctx, t.profileId)).rejects.toThrow(/request/i);
  });

  it('refuses on a request that is only PENDING — approval is a second, named decision', async () => {
    const t = await makeTech('TECH-200002', 'Nia S', A, BR_A, '+18565552002');
    await admin.requestDeletion(ctx, t.profileId, { reason: 'She asked us to delete her account.', requesterKind: 'technician' });
    await expect(admin.anonymize(ctx, t.profileId)).rejects.toThrow(/approved/i);
  });

  it('a LEGAL HOLD blocks even an approved request', async () => {
    const t = await makeTech('TECH-200003', 'Zoe T', A, BR_A, '+18565552003');
    const r = await admin.requestDeletion(ctx, t.profileId, { reason: 'Erasure request', requesterKind: 'technician', legalHold: true });
    await admin.decideDeletion(ctx, r.requestId, 'approve');
    await expect(admin.anonymize(ctx, t.profileId)).rejects.toThrow(/legal hold/i);
  });

  it('erases HER data — and preserves the salon’s books, exactly as the spec demands', async () => {
    const t = await makeTech('TECH-200004', 'Eva W', A, BR_A, '+18565552004');
    await q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, moderation_status, is_public) values ($1,'a.jpg','approved',true)`, [t.profileId]);
    await q(`insert into customer_favorite_techs (user_id, global_tech_profile_id) values ($1,$2)`, [ADMIN, t.profileId]);

    const req = await admin.requestDeletion(ctx, t.profileId, { reason: 'Technician requested account deletion.', requesterKind: 'technician' });
    await admin.decideDeletion(ctx, req.requestId, 'approve');
    const done = await admin.anonymize(ctx, t.profileId);
    expect(done.status).toBe('anonymized');

    const [p]: any = await q(`select * from global_tech_profiles where id = $1`, [t.profileId]);
    expect(p.status).toBe('anonymized');
    expect(p.normalized_phone).toBeNull();
    expect(p.phone_hash).toBeNull();
    expect(p.email_normalized).toBeNull();
    expect(p.avatar_url).toBeNull();
    expect(p.is_public).toBe(false);
    expect(p.display_name).toContain('TECH-200004');   // the tombstone still says who this WAS
    expect(p.tech_code).toBe('TECH-200004');           // and the id is never reused

    // her stuff is gone
    expect((await q(`select count(*)::int n from customer_favorite_techs where global_tech_profile_id = $1`, [t.profileId]))[0].n).toBe(0);
    expect((await q(`select is_public from tech_portfolio_photos where global_tech_profile_id = $1`, [t.profileId]))[0].is_public).toBe(false);

    // THE SALON'S BOOKS SURVIVE. Payroll, tickets and audit all key on technician_id — never on the profile.
    expect((await q(`select count(*)::int n from technicians where id = $1`, [t.technicianId]))[0].n).toBe(1);
    expect((await q(`select count(*)::int n from tech_salon_memberships where global_tech_profile_id = $1`, [t.profileId]))[0].n).toBe(1);
    expect((await q(`select status from tech_salon_memberships where global_tech_profile_id = $1`, [t.profileId]))[0].status).toBe('former');
    expect((await q(`select status from users where id = $1`, [t.userId]))[0].status).toBe('inactive');
  });

  it('the released phone number is free for a NEW technician — but the old id is not', async () => {
    // A tombstone must not block the next person who happens to get that number.
    const fresh = await makeTech('TECH-200005', 'New Person', B, BR_B, '+18565552004');
    expect(fresh.profileId).toBeTruthy();
  });
});

describe('D4 — an approved cross-tenant transfer actually MOVES somebody', () => {
  it('provisions the membership at the target salon — and does NOT fire her from the old one yet', async () => {
    const t = await makeTech('TECH-300001', 'Ivy K', A, BR_A, '+18565553001');

    const r = await executor.execute({
      requestId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', userId: t.userId,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: ADMIN, decidedByUserId: ADMIN,
    });

    expect(r.executed).toBe(true);
    // Super Admin approved it; SHE has not. Her global identity does not attach to a salon on somebody else's say-so.
    expect(r.membershipStatus).toBe('pending_tech_approval');

    const [m]: any = await q(`select status, transfer_from_tenant_id from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [t.profileId, B]);
    expect(m.status).toBe('pending_tech_approval');
    expect(m.transfer_from_tenant_id).toBe(A);

    // AND SHE IS STILL EMPLOYED AT LUXE. Ending it now would fire her from a job she still has, over a move she
    // has not accepted — and if she declined, she would be employed nowhere.
    expect((await q(`select status from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [t.profileId, A]))[0].status).toBe('active');
    // no roster row at the new salon either — the salon does not get to schedule her over a decision she has not made
    expect((await q(`select count(*)::int n from technicians where global_tech_profile_id = $1 and tenant_id = $2`, [t.profileId, B]))[0].n).toBe(0);
  });

  it('when SHE asked for the move, it is immediate — consent is already on the record', async () => {
    const t = await makeTech('TECH-300002', 'Lena M', A, BR_A, '+18565553002');

    const r = await executor.execute({
      requestId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', userId: t.userId,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: t.userId, decidedByUserId: ADMIN,
    });

    expect(r.membershipStatus).toBe('active');
    // and now it is REAL: a login at the new salon and a place on its roster
    expect((await q(`select count(*)::int n from users where global_tech_profile_id = $1 and tenant_id = $2`, [t.profileId, B]))[0].n).toBe(1);
    expect((await q(`select count(*)::int n from technicians where global_tech_profile_id = $1 and tenant_id = $2`, [t.profileId, B]))[0].n).toBe(1);
    // the departure fires on arrival
    expect((await q(`select status from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [t.profileId, A]))[0].status).toBe('former');
  });

  it('a worker who is not a global technician is reported honestly, never as a success', async () => {
    const u: any = (await q(`insert into users (tenant_id, branch_id, role, status, full_name) values ($1,$2,'MANAGER','active','A Manager') returning id`, [A, BR_A]))[0];
    const r = await executor.execute({
      requestId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', userId: u.id,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: ADMIN, decidedByUserId: ADMIN,
    });
    expect(r).toMatchObject({ executed: false, reason: 'not_a_global_technician' });
  });

  it('a SUSPENDED platform account is not transferred anywhere', async () => {
    const t = await makeTech('TECH-300003', 'Suspended S', A, BR_A, '+18565553003');
    await admin.suspend(ctx, t.profileId, 'Under investigation');
    const r = await executor.execute({
      requestId: 'ffffffff-0000-0000-0000-000000000000', userId: t.userId,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: t.userId, decidedByUserId: ADMIN,
    });
    expect(r).toMatchObject({ executed: false, reason: 'account_not_active' });
  });
});

describe('PAUSE — a reversible restriction, kept distinct from a suspension', () => {
  it('pauses an active account, records history + audit, then reactivates it', async () => {
    const t = await makeTech('PAUSE1', 'Pause One', A, BR_A, '+15550000901');
    const paused = await admin.pauseAccount(ctx, t.profileId, 'Technician requested a break');
    expect(paused).toMatchObject({ ok: true, status: 'paused' });
    const row: any = (await q(`select status, paused_at, pause_reason, suspended_at from global_tech_profiles where id=$1`, [t.profileId]))[0];
    expect(row.status).toBe('paused');
    expect(row.paused_at).toBeTruthy();
    expect(row.suspended_at).toBeNull();            // pause never touches the suspend fields
    const hist: any = await admin.statusHistory(t.profileId);
    expect(hist.events[0]).toMatchObject({ toStatus: 'paused', action: 'paused', reason: 'Technician requested a break' });
    const audits: any = await q(`select action_type from audit_logs where action_type='super_admin.tech_account_paused'`);
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const re = await admin.reactivateAccount(ctx, t.profileId);
    expect(re).toMatchObject({ ok: true, status: 'active' });
    const back: any = (await q(`select status, paused_at, pause_reason from global_tech_profiles where id=$1`, [t.profileId]))[0];
    expect(back.status).toBe('active');
    expect(back.paused_at).toBeNull();
  });

  it('requires a reason and only pauses an active account', async () => {
    const t = await makeTech('PAUSE2', 'Pause Two', A, BR_A, '+15550000902');
    await expect(admin.pauseAccount(ctx, t.profileId, '   ')).rejects.toBeInstanceOf(GlobalTechAdminError);
    await admin.pauseAccount(ctx, t.profileId, 'review');
    await expect(admin.pauseAccount(ctx, t.profileId, 'again')).rejects.toBeInstanceOf(GlobalTechAdminError); // already paused
  });

  it('keeps pause and suspend separate: a suspended account cannot be reactivated (that is what restore is for)', async () => {
    const t = await makeTech('PAUSE3', 'Pause Three', A, BR_A, '+15550000903');
    await admin.suspend(ctx, t.profileId, 'policy');
    await expect(admin.reactivateAccount(ctx, t.profileId)).rejects.toBeInstanceOf(GlobalTechAdminError);
    // and a paused account cannot be "restored" (restore is the suspension inverse)
    const t2 = await makeTech('PAUSE4', 'Pause Four', A, BR_A, '+15550000904');
    await admin.pauseAccount(ctx, t2.profileId, 'break');
    await expect(admin.restore(ctx, t2.profileId)).rejects.toBeInstanceOf(GlobalTechAdminError);
  });
});

describe('MEMBERSHIP PAUSE — one salon, without touching the account or the others', () => {
  it('pauses one membership while the global account and the other membership stay active', async () => {
    const t = await makeTech('MPAUSE1', 'Mem Pause', A, BR_A, '+15550000911');
    // a second salon relationship for the same global profile
    const m2: any = (await q(
      `insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, status, start_date)
       values ($1,$2,$3,'active',now()) returning id`, [t.profileId, B, BR_B]))[0];

    const res = await admin.pauseMembership(ctx, t.membershipId, 'salon under review');
    expect(res).toMatchObject({ ok: true, status: 'paused' });

    const a: any = (await q(`select status, pause_reason from tech_salon_memberships where id=$1`, [t.membershipId]))[0];
    const b: any = (await q(`select status from tech_salon_memberships where id=$1`, [m2.id]))[0];
    const acct: any = (await q(`select status from global_tech_profiles where id=$1`, [t.profileId]))[0];
    expect(a.status).toBe('paused');
    expect(a.pause_reason).toBe('salon under review');
    expect(b.status).toBe('active');          // sibling membership untouched
    expect(acct.status).toBe('active');        // global account untouched

    const hist: any = await admin.statusHistory(t.profileId);
    expect(hist.events[0]).toMatchObject({ action: 'membership_paused', scope: 'salon_membership' });

    const back = await admin.reactivateMembership(ctx, t.membershipId);
    expect(back).toMatchObject({ ok: true, status: 'active' });
    expect(((await q(`select status from tech_salon_memberships where id=$1`, [t.membershipId]))[0] as any).status).toBe('active');
  });

  it('requires a reason, only pauses an active membership, and only reactivates a paused one', async () => {
    const t = await makeTech('MPAUSE2', 'Mem Pause2', A, BR_A, '+15550000912');
    await expect(admin.pauseMembership(ctx, t.membershipId, '  ')).rejects.toBeInstanceOf(GlobalTechAdminError);
    await admin.pauseMembership(ctx, t.membershipId, 'reason');
    await expect(admin.pauseMembership(ctx, t.membershipId, 'again')).rejects.toBeInstanceOf(GlobalTechAdminError);
    const t2 = await makeTech('MPAUSE3', 'Mem Pause3', A, BR_A, '+15550000913');
    await expect(admin.reactivateMembership(ctx, t2.membershipId)).rejects.toBeInstanceOf(GlobalTechAdminError); // active, not paused
  });
});

describe('SCOPED PAUSE — suppress one facet without changing account status', () => {
  it('hides the profile / pauses messaging / freezes deals as separate flags, each audited, account untouched', async () => {
    const t = await makeTech('SCOPE1', 'Scope One', A, BR_A, '+15550000921');
    for (const scope of ['profile', 'messaging', 'deals'] as const) {
      await admin.setScopedPause(ctx, t.profileId, scope, true, `${scope} under review`);
    }
    const row: any = (await q(`select status, admin_profile_hidden, admin_messaging_paused, admin_deals_frozen from global_tech_profiles where id=$1`, [t.profileId]))[0];
    expect(row.admin_profile_hidden).toBe(true);
    expect(row.admin_messaging_paused).toBe(true);
    expect(row.admin_deals_frozen).toBe(true);
    expect(row.status).toBe('active');   // account status is not a scoped facet
    const audits: any = await q(`select action_type from audit_logs where action_type like 'super_admin.tech_%' and entity_id=$1`, [t.profileId]);
    expect(audits.length).toBeGreaterThanOrEqual(3);

    await admin.setScopedPause(ctx, t.profileId, 'profile', false);   // lifting needs no reason
    expect(((await q(`select admin_profile_hidden from global_tech_profiles where id=$1`, [t.profileId]))[0] as any).admin_profile_hidden).toBe(false);
  });

  it('requires a reason to pause, and rejects an unknown scope', async () => {
    const t = await makeTech('SCOPE2', 'Scope Two', A, BR_A, '+15550000922');
    await expect(admin.setScopedPause(ctx, t.profileId, 'messaging', true, '  ')).rejects.toBeInstanceOf(GlobalTechAdminError);
    await expect(admin.setScopedPause(ctx, t.profileId, 'bogus' as any, true, 'x')).rejects.toBeInstanceOf(GlobalTechAdminError);
  });
});

describe('SUSPEND CASCADE — a suspension actually cuts access, not just a label', () => {
  it('hides profile, blocks messaging, freezes deals, revokes sessions, and notifies — then restore lifts it all', async () => {
    const t = await makeTech('CASCADE1', 'Cascade One', A, BR_A, '+15550000931');
    // a live session for this login
    await q(`insert into sessions (user_id, tenant_id, expires_at) values ($1,$2, now() + interval '1 day')`, [t.userId, A]);

    const res: any = await admin.suspend(ctx, t.profileId, 'fraud investigation');
    expect(res.status).toBe('suspended');
    const p: any = (await q(`select status, admin_profile_hidden, admin_messaging_paused, admin_deals_frozen from global_tech_profiles where id=$1`, [t.profileId]))[0];
    expect(p).toMatchObject({ status: 'suspended', admin_profile_hidden: true, admin_messaging_paused: true, admin_deals_frozen: true });
    const liveSessions: any = await q(`select count(*)::int n from sessions where user_id=$1 and revoked_at is null`, [t.userId]);
    expect(liveSessions[0].n).toBe(0);                       // every session cut
    const notes: any = await q(`select title from technician_notifications where technician_id=$1 and type='account'`, [t.technicianId]);
    expect(notes.length).toBeGreaterThanOrEqual(1);

    await admin.restore(ctx, t.profileId);
    const back: any = (await q(`select status, admin_profile_hidden, admin_messaging_paused, admin_deals_frozen from global_tech_profiles where id=$1`, [t.profileId]))[0];
    expect(back).toMatchObject({ status: 'active', admin_profile_hidden: false, admin_messaging_paused: false, admin_deals_frozen: false });
  });
});

describe('TRANSFER VALIDATION — you do not move someone mid-service or with cash unreconciled', () => {
  it('blocks on an open service, then on a pending cash handoff, then goes through once both clear', async () => {
    const t = await makeTech('TECH-500001', 'Nadia P', A, BR_A, '+18565555001');
    const exec = () => executor.execute({
      requestId: 'a5000000-0000-0000-0000-000000000001', userId: t.userId,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: ADMIN, decidedByUserId: ADMIN,
    });

    // 1) mid-service at the source salon → blocked
    const qi: any = (await q(`insert into pos_queue_items (tenant_id, customer_name, status, assigned_technician_id) values ($1,'Walk In','in_service',$2) returning id`, [A, t.technicianId]))[0];
    expect(await exec()).toMatchObject({ executed: false, reason: 'open_service' });

    // 2) service done, but cash not reconciled → blocked
    await q(`update pos_queue_items set status='cancelled' where id=$1`, [qi.id]);
    await q(`insert into tech_cash_handoffs (tenant_id, technician_id, status, business_date) values ($1,$2,'submitted',current_date)`, [A, t.technicianId]);
    expect(await exec()).toMatchObject({ executed: false, reason: 'cash_handoff_pending' });

    // 3) reconciled → the move goes through
    await q(`update tech_cash_handoffs set status='reconciled' where technician_id=$1`, [t.technicianId]);
    expect(await exec()).toMatchObject({ executed: true });
  });
});

describe('SUPPORT PANEL — read the posture, cut the sessions', () => {
  it('summarizes live sessions + open tickets, and revokes sessions on demand', async () => {
    const t = await makeTech('SUP1', 'Support One', A, BR_A, '+15550000941');
    await q(`insert into sessions (user_id, tenant_id, expires_at) values ($1,$2, now() + interval '1 day')`, [t.userId, A]);
    await q(`insert into support_tickets (tenant_id, created_by_user_id, ticket_number, subject, status) values ($1,$2,'TCK-SUP-1','Cannot log in','open')`, [A, t.userId]);
    await q(`insert into support_tickets (tenant_id, created_by_user_id, ticket_number, subject, status) values ($1,$2,'TCK-SUP-2','Old resolved','closed')`, [A, t.userId]);

    const sum: any = await admin.techSupportSummary(ctx, t.profileId);
    expect(sum.accountStatus).toBe('active');
    expect(sum.activeSessions).toBe(1);
    expect(sum.openTicketCount).toBe(1);                    // the closed one is excluded
    expect(sum.openTickets[0].subject).toBe('Cannot log in');
    expect(sum.elevatedForDangerousActions).toBe(true);     // seeded ADMIN holds a security_admin grant
    // an operator with no grant sees they are not elevated
    const bare: any = await admin.techSupportSummary({ userId: 'facade00-0000-0000-0000-00000000000e' }, t.profileId);
    expect(bare.elevatedForDangerousActions).toBe(false);

    const rv: any = await admin.revokeSessions(ctx, t.profileId);
    expect(rv.sessionsRevoked).toBeGreaterThanOrEqual(1);
    const after: any = await admin.techSupportSummary(ctx, t.profileId);
    expect(after.activeSessions).toBe(0);
    const audit: any = await q(`select action_type from audit_logs where action_type='super_admin.tech_sessions_revoked' and entity_id=$1`, [t.profileId]);
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});

describe('LOCK / UNLOCK — a security stop that blocks login and cuts sessions', () => {
  it('locks an active account (revoking sessions), then unlocks it', async () => {
    const t = await makeTech('LOCK1', 'Lock One', A, BR_A, '+15550000951');
    await q(`insert into sessions (user_id, tenant_id, expires_at) values ($1,$2, now() + interval '1 day')`, [t.userId, A]);
    const res: any = await admin.lockAccount(ctx, t.profileId, 'credential compromise');
    expect(res).toMatchObject({ ok: true, status: 'locked' });
    expect(((await q(`select status from global_tech_profiles where id=$1`, [t.profileId]))[0] as any).status).toBe('locked');
    expect(((await q(`select count(*)::int n from sessions where user_id=$1 and revoked_at is null`, [t.userId]))[0] as any).n).toBe(0);
    const hist: any = await admin.statusHistory(t.profileId);
    expect(hist.events[0]).toMatchObject({ action: 'locked', reason: 'credential compromise' });

    const un = await admin.unlockAccount(ctx, t.profileId);
    expect(un).toMatchObject({ ok: true, status: 'active' });
    expect(((await q(`select status from global_tech_profiles where id=$1`, [t.profileId]))[0] as any).status).toBe('active');
  });

  it('requires a reason to lock, and only unlocks a locked account', async () => {
    const t = await makeTech('LOCK2', 'Lock Two', A, BR_A, '+15550000952');
    await expect(admin.lockAccount(ctx, t.profileId, '  ')).rejects.toBeInstanceOf(GlobalTechAdminError);
    await expect(admin.unlockAccount(ctx, t.profileId)).rejects.toBeInstanceOf(GlobalTechAdminError); // active, not locked
  });
});

describe('DESTINATION APPROVAL — the receiving salon signs off before the technician does', () => {
  it('parks at pending_salon_approval, then approval moves it to the technician consent gate', async () => {
    const t = await makeTech('DEST1', 'Dest One', A, BR_A, '+15550000961');
    const r = await executor.execute({
      requestId: 'de510000-0000-0000-0000-000000000001', userId: t.userId,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: ADMIN, decidedByUserId: ADMIN,
      requireDestinationApproval: true,
    });
    expect(r.executed).toBe(true);
    expect(r.membershipStatus).toBe('pending_salon_approval');
    const mid = r.membershipId as string;

    const dec = await admin.decideDestinationApproval(ctx, mid, true);
    expect(dec).toMatchObject({ ok: true, status: 'pending_tech_approval' });
    expect(((await q(`select status from tech_salon_memberships where id=$1`, [mid]))[0] as any).status).toBe('pending_tech_approval');
  });

  it('rejection closes the incoming membership, and a normal transfer is unaffected', async () => {
    const t = await makeTech('DEST2', 'Dest Two', A, BR_A, '+15550000962');
    const r = await executor.execute({
      requestId: 'de520000-0000-0000-0000-000000000002', userId: t.userId,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: ADMIN, decidedByUserId: ADMIN, requireDestinationApproval: true,
    });
    await admin.decideDestinationApproval(ctx, r.membershipId as string, false, 'salon declined');
    expect(((await q(`select status from tech_salon_memberships where id=$1`, [r.membershipId]))[0] as any).status).toBe('rejected');
    // can't decide again — no longer awaiting destination approval
    await expect(admin.decideDestinationApproval(ctx, r.membershipId as string, true)).rejects.toBeInstanceOf(GlobalTechAdminError);

    // a transfer WITHOUT the flag still lands at the technician gate directly (unchanged behavior)
    const t2 = await makeTech('DEST3', 'Dest Three', A, BR_A, '+15550000963');
    const r2 = await executor.execute({
      requestId: 'de530000-0000-0000-0000-000000000003', userId: t2.userId,
      fromTenantId: A, toTenantId: B, toBranchId: BR_B, requestedBy: ADMIN, decidedByUserId: ADMIN,
    });
    expect(r2.membershipStatus).toBe('pending_tech_approval');
  });
});

describe('ELEVATED APPROVAL — the irreversible actions need a live security grant, not just permission', () => {
  const noGrantCtx = { userId: 'facade00-0000-0000-0000-000000000009', ip: undefined };
  it('blocks merge and anonymize for an operator who is not currently elevated', async () => {
    const one = await makeTech('ELEV1', 'Elev One', A, BR_A, '+15550000971');
    const two = await makeTech('ELEV2', 'Elev Two', B, BR_B, '+15550000972');
    await expect(admin.merge(noGrantCtx, one.profileId, two.profileId, 'dupe')).rejects.toMatchObject({ code: 'elevation_required' });
    await expect(admin.anonymize(noGrantCtx, one.profileId)).rejects.toMatchObject({ code: 'elevation_required' });
  });

  it('lets an elevated operator through (the seeded ADMIN holds an active grant)', async () => {
    // ADMIN is elevated in beforeAll; a merge that is otherwise valid is NOT stopped by the elevation gate.
    const a = await makeTech('ELEV3', 'Elev Three', A, BR_A, '+15550000973');
    const b = await makeTech('ELEV4', 'Elev Four', B, BR_B, '+15550000974');
    const r = await admin.merge(ctx, a.profileId, b.profileId, 'same person');
    expect(r).toBeTruthy();
  });
});

describe('MY ELEVATION — the acting operator can read their own elevation state', () => {
  it('reports elevated for the seeded admin and not for an operator without a grant', async () => {
    expect((await admin.myElevation(ctx)).elevated).toBe(true);
    expect((await admin.myElevation({ userId: 'facade00-0000-0000-0000-00000000001a' })).elevated).toBe(false);
  });
});
