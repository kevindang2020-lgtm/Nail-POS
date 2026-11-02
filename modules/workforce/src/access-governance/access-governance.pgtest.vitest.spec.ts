// access-governance.pgtest.vitest.spec.ts — BUILD_PLAN Phase 9: /pos/security against the real schema (PGlite with every
// migration): access reviews (snapshot, one open review, keep / change / revoke with the authorization version, audit,
// AUTHORIZATION_CHANGED and session revocation, last owner, never yourself, completion), the high-risk report (incl. an
// override), dormant accounts + the dormant-alert job (worker principal, once per episode), denial metrics, isolation.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { permissionsFor } from '@aipowersalon/permissions';
import { AuthorizationStateCache, KyselyAuthorizationStatePort } from '@aipowersalon/identity';
import { AccessGovernanceService, GovernanceError, type GovernanceActor } from './access-governance.service';

const T = 'a9100000-0000-4000-8000-0000000000a1', T2 = 'a9100000-0000-4000-8000-0000000000a2';
const B1 = 'b9100000-0000-4000-8000-0000000000b1', B9 = 'b9100000-0000-4000-8000-0000000000b9';
const OWNER = 'c9100000-0000-4000-8000-0000000000c1', MGR = 'c9100000-0000-4000-8000-0000000000c2', DESK = 'c9100000-0000-4000-8000-0000000000c3';
const TECH = 'c9100000-0000-4000-8000-0000000000c4', QUIET = 'c9100000-0000-4000-8000-0000000000c5', OTHER_OWNER = 'c9100000-0000-4000-8000-0000000000c9';
let pg: any; let db: any; let svc: AccessGovernanceService;
const owner: GovernanceActor = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') };
const otherOwner: GovernanceActor = { tenantId: T2, userId: OTHER_OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') };
const fail = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof GovernanceError ? `${e.status} ${e.code}` : String(e)));
const one = async (q: any) => (await q.execute(db) as any).rows[0];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) VALUES
      ('${T}','Gov LLC','Gov','gov-p9b','RACEP9B','active','${OWNER}'), ('${T2}','Other LLC','Other','other-p9b','RACEP9B2','active','${OTHER_OWNER}');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active'), ('${B9}','${T2}','Elsewhere','active');
    INSERT INTO users (id, tenant_id, branch_id, email, full_name, status, role, last_login_at, created_at) VALUES
      ('${OWNER}','${T}','${B1}','o@gov.test','Olga Owner','active','OWNER', now(), now() - interval '400 days'),
      ('${MGR}','${T}','${B1}','m@gov.test','Max Manager','active','MANAGER', now() - interval '2 days', now() - interval '400 days'),
      ('${DESK}','${T}','${B1}','d@gov.test','Dee Desk','active','FRONT_DESK', now() - interval '1 day', now() - interval '400 days'),
      ('${TECH}','${T}','${B1}','t@gov.test','Tia Tech','active','TECHNICIAN', now() - interval '90 days', now() - interval '400 days'),
      ('${QUIET}','${T}','${B1}','q@gov.test','Quinn Quiet','active','RECEPTION', null, now() - interval '300 days'),
      ('${OTHER_OWNER}','${T2}','${B9}','x@other.test','Xena Other','active','OWNER', now(), now());
    INSERT INTO tenant_user_permission_overrides (tenant_id, user_id, permission, effect, reason, granted_by_user_id) VALUES ('${T}','${DESK}','customers.export','ALLOW','campaign list','${OWNER}');
    INSERT INTO authorization_denials (tenant_id, user_id, role, permission, reason, count, first_at, last_at) VALUES
      ('${T}','${DESK}','FRONT_DESK','checkout.approve_refund','missing_permission',4, now() - interval '1 hour', now()),
      ('${T}','${TECH}','TECHNICIAN','customers.export','missing_permission',1, now() - interval '2 hours', now() - interval '1 hour'),
      ('${T2}','${OTHER_OWNER}','OWNER','x.y','missing_permission',9, now(), now());
    INSERT INTO sessions (id, user_id, tenant_id, status, expires_at) VALUES (gen_random_uuid(), '${TECH}', '${T}', 'active', now() + interval '1 day');`);
  svc = new AccessGovernanceService(db, new OutboxWriter(), new AuthorizationStateCache(new KyselyAuthorizationStatePort(db), 30_000));
}, 120_000);

describe('high-risk report', () => {
  it('lists who holds high / critical keys and why — incl. the front desk\'s ALLOW override; never another salon', async () => {
    const r = await svc.highRisk(owner);
    const desk = r.rows.find((x) => x.userId === DESK)!;
    expect(desk.permissions).toContainEqual({ key: 'customers.export', sensitivity: 'high', via: 'granted_by_override' });
    expect(r.rows.find((x) => x.userId === OWNER)!.permissions.find((p) => p.key === 'ownership.transfer')).toMatchObject({ sensitivity: 'critical', via: 'granted_by_role' });
    expect(r.rows.some((x) => x.userId === OTHER_OWNER)).toBe(false);
  });
});

describe('dormant accounts + the dormant-alert job', () => {
  it('lists active staff quiet for > 60 days (never-signed-in from creation), not the recently active', async () => {
    const r = await svc.dormant(owner);
    expect(r.thresholdDays).toBe(60);
    expect(r.rows.map((x) => x.userId).sort()).toEqual([QUIET, TECH].sort());
    expect((await svc.dormant(owner, '100')).rows.map((x) => x.userId)).toEqual([QUIET]);
  });
  it('the job raises ONE owner alert per dormant account (worker:dormant-accounts) and never repeats it', async () => {
    expect(await svc.tenantsWithDormant(60)).toContain(T);
    expect(await svc.alertDormantForTenant(T)).toBe(2);
    expect(await svc.alertDormantForTenant(T)).toBe(0);
    const a: any = await one(sql`select count(*)::int as n, max(audience) as aud, max(metadata->>'actor') as actor from owner_alerts where tenant_id = ${T} and metadata->>'kind' = 'dormant_account'`);
    expect(a).toMatchObject({ n: 2, aud: 'owner', actor: 'worker:dormant-accounts' });
    // a new dormancy episode (signed in, then quiet again) alerts again
    await sql`update users set last_login_at = now() - interval '61 days' where id = ${TECH}`.execute(db);
    expect(await svc.alertDormantForTenant(T)).toBe(1);
  });
});

describe('denial metrics', () => {
  it('sums this salon\'s denials in the window', async () => {
    const m = await svc.denials(owner);
    expect(m.total).toBe(5);
    expect(m.byKey[0]).toEqual({ key: 'checkout.approve_refund', count: 4 });
    expect(m.byUser.find((u) => u.userId === DESK)).toMatchObject({ name: 'Dee Desk', count: 4 });
    expect(await fail(svc.denials(owner, '2026-10-08', '2026-01-01'))).toBe('400 VALIDATION_FAILED');
  });
});

describe('access reviews', () => {
  let id: string;
  it('starts with a snapshot of every active member and their high-risk keys; one open review per salon', async () => {
    const r = await svc.startReview(owner, {});
    id = r.id;
    expect(r.status).toBe('open');
    expect(r.items.map((i) => i.userId).sort()).toEqual([OWNER, MGR, DESK, TECH, QUIET].sort());
    expect(r.items.find((i) => i.userId === DESK)!.highRiskPermissions).toContain('customers.export');
    expect(await fail(svc.startReview(owner, {}))).toBe('409 CONFLICT');
    expect(await fail(svc.getReview(otherOwner, id))).toBe('404 RESOURCE_NOT_FOUND');   // another salon cannot see it
  });
  it('refuses self revoke / change and the last active owner; validates', async () => {
    expect(await fail(svc.decide(owner, id, { userId: OWNER, decision: 'revoke', note: 'x' }))).toBe('403 PERMISSION_DENIED');
    expect(await fail(svc.decide(owner, id, { userId: MGR, decision: 'change' }))).toBe('400 VALIDATION_FAILED');
    const mgrActor: GovernanceActor = { tenantId: T, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') };
    expect(await fail(svc.decide(mgrActor, id, { userId: OWNER, decision: 'revoke', note: 'coup' }))).toBe('409 LAST_OWNER');
    const item: any = await one(sql`select decision from access_review_items where review_id = ${id} and user_id = ${OWNER}`);
    expect(item.decision).toBeNull();   // the refused revoke left nothing behind
  });
  it('revoke: the account goes inactive, its version bumps, audit + AUTHORIZATION_CHANGED written, sessions ended', async () => {
    const v0 = Number((await one(sql`select authorization_version as v from users where id = ${TECH}`)).v);
    const e0 = Number((await one(sql`select count(*)::int as n from outbox_events where event_type = 'authorization.changed' and tenant_id = ${T}`)).n);
    const r = await svc.decide(owner, id, { userId: TECH, decision: 'revoke', note: 'left the salon' });
    expect(r.items.find((i) => i.userId === TECH)).toMatchObject({ decision: 'revoke', note: 'left the salon' });
    const u: any = await one(sql`select status, authorization_version as v from users where id = ${TECH}`);
    expect(u.status).toBe('inactive'); expect(Number(u.v)).toBeGreaterThan(v0);
    expect(Number((await one(sql`select count(*)::int as n from outbox_events where event_type = 'authorization.changed' and tenant_id = ${T}`)).n)).toBe(e0 + 1);
    const aud: any = await one(sql`select action, after_state from authorization_audit_events where tenant_id = ${T} and target_user_id = ${TECH} order by created_at desc limit 1`);
    expect(aud.action).toBe('access_review.decided'); expect(aud.after_state).toMatchObject({ status: 'inactive', decision: 'revoke' });
    const live: any = await one(sql`select count(*)::int as n from sessions where user_id = ${TECH} and status = 'active'`);
    expect(Number(live.n)).toBe(0);
    expect(await fail(svc.decide(owner, id, { userId: TECH, decision: 'keep' }))).toBe('409 CONFLICT');   // decided once
  });
  it('change: moves the person to another template through the staff-roles path (audited)', async () => {
    const r = await svc.decide(owner, id, { userId: DESK, decision: 'change', templateKey: 'SUPPORT_STAFF', note: 'look-up only' });
    expect(r.items.find((i) => i.userId === DESK)).toMatchObject({ decision: 'change', templateKey: 'SUPPORT_STAFF' });
    const a: any = await one(sql`select template_key from staff_role_assignments where tenant_id = ${T} and user_id = ${DESK}`);
    expect(a.template_key).toBe('SUPPORT_STAFF');
  });
  it('cannot complete while someone is undecided; completes once everyone is decided', async () => {
    expect(await fail(svc.complete(owner, id))).toBe('409 CONFLICT');
    for (const u of [OWNER, MGR, QUIET]) await svc.decide(owner, id, { userId: u, decision: 'keep' });
    const done = await svc.complete(owner, id);
    expect(done.status).toBe('completed'); expect(done.completedAt).toBeTruthy();
    expect(await fail(svc.complete(owner, id))).toBe('409 CONFLICT');
    expect((await svc.listReviews(owner)).map((x) => x.id)).toEqual([id]);
    expect(await svc.listReviews(otherOwner)).toEqual([]);
    // a new review may start once the last one is closed
    expect((await svc.startReview(owner, { dueAt: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe('open');
  });
});
