// Constitution 7 §16 (decision D6) on the real schema: lifecycle_state and the access status can never disagree, for
// any writer — new lifecycle writes drive status; legacy status writes keep or derive the lifecycle state.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';
import { seedRow } from '../events/pgtest-seed';

const T = '57575757-5757-4575-8575-575757575757';
let pg: any;
const row = async () => (await pg.query(`select status, lifecycle_state from tenants where id = $1`, [T])).rows[0];
beforeAll(async () => {
  pg = await migratedPglite();
  await seedRow(pg, 'tenants', { id: T, legal_name: 'L', display_name: 'Lifecycle', tenant_slug: 'lifecycle', tenant_code: 'LIFE01', status: 'pending' });
});

describe('tenant lifecycle state (§16)', () => {
  it('a new tenant gets the default lifecycle for its status (pending → ONBOARDING), whatever placeholder an insert carried', async () => {
    expect(await row()).toEqual({ status: 'pending', lifecycle_state: 'ONBOARDING' });
  });
  it('a lifecycle write drives the access status', async () => {
    await pg.query(`update tenants set lifecycle_state = 'PENDING_APPROVAL' where id = $1`, [T]);
    expect(await row()).toEqual({ status: 'pending', lifecycle_state: 'PENDING_APPROVAL' });
    await pg.query(`update tenants set lifecycle_state = 'PAST_DUE' where id = $1`, [T]);
    expect(await row()).toEqual({ status: 'active', lifecycle_state: 'PAST_DUE' });
    await pg.query(`update tenants set lifecycle_state = 'RESTRICTED' where id = $1`, [T]);
    expect(await row()).toEqual({ status: 'suspended', lifecycle_state: 'RESTRICTED' });
  });
  it('a legacy status write keeps a lifecycle state that already fits, and otherwise derives one', async () => {
    await pg.query(`update tenants set status = 'suspended' where id = $1`, [T]);            // RESTRICTED already means suspended
    expect(await row()).toEqual({ status: 'suspended', lifecycle_state: 'RESTRICTED' });
    await pg.query(`update tenants set status = 'active' where id = $1`, [T]);                // reactivation by the old path
    expect(await row()).toEqual({ status: 'active', lifecycle_state: 'ACTIVE' });
    await pg.query(`update tenants set status = 'cancelled' where id = $1`, [T]);
    expect(await row()).toEqual({ status: 'cancelled', lifecycle_state: 'CLOSED' });
    expect((await pg.query(`select closed_at from tenants where id = $1`, [T])).rows[0].closed_at).toBeTruthy();   // §21 clock starts on a legacy close too
  });
  it('an unknown state is refused, and writing both columns inconsistently resolves to the lifecycle (never a mismatch)', async () => {
    await expect(pg.query(`update tenants set lifecycle_state = 'PAUSED' where id = $1`, [T])).rejects.toBeTruthy();
    await pg.query(`update tenants set lifecycle_state = 'ARCHIVED', status = 'active' where id = $1`, [T]);
    expect(await row()).toEqual({ status: 'cancelled', lifecycle_state: 'ARCHIVED' });
  });
});

// ── the service path: transition rules, audit, and the platform event when access status moves ─────────────────────────
import { sql } from 'kysely';
import { kyselyFor } from '@aipowersalon/testing';
import { KyselySuperAdminTenantsRepo, SuperAdminTenantsService } from '@aipowersalon/super-admin';

describe('changeLifecycle (service, real schema)', () => {
  const S = '58585858-5858-4585-8585-585858585858';
  let db: any; let svc: any;
  beforeAll(async () => {
    db = kyselyFor(pg);
    await seedRow(pg, 'tenants', { id: S, legal_name: 'S', display_name: 'Service Path', tenant_slug: 'servicepath', tenant_code: 'SERV01', status: 'active' });
    svc = new SuperAdminTenantsService(new KyselySuperAdminTenantsRepo(db));
  });
  it('ACTIVE → PAST_DUE keeps access (status active) and is audited with from/to', async () => {
    expect(await svc.changeLifecycle(S, 'PAST_DUE', undefined, undefined, { userId: '59595959-5959-4595-8595-595959595959' })).toMatchObject({ ok: true, from: 'ACTIVE', to: 'PAST_DUE', status: 'active' });
    const a = (await sql<any>`select metadata_json from audit_logs where action_type = 'tenant_lifecycle_changed' and entity_id = ${S}`.execute(db)).rows;
    expect(a.map((x: any) => [x.metadata_json.from, x.metadata_json.to])).toEqual([['ACTIVE', 'PAST_DUE']]);
  });
  it('an illegal move is refused and changes nothing; a legal suspension moves access to suspended and keeps the code', async () => {
    expect(await svc.changeLifecycle(S, 'ONBOARDING', 'going back to onboarding')).toMatchObject({ ok: false });
    expect(await svc.changeLifecycle(S, 'SUSPENDED', 'unpaid for 45 days')).toMatchObject({ ok: false });     // no code
    expect((await pg.query(`select lifecycle_state from tenants where id = $1`, [S])).rows[0].lifecycle_state).toBe('PAST_DUE');
    expect(await svc.changeLifecycle(S, 'SUSPENDED', 'unpaid for 45 days', 'BILLING')).toMatchObject({ ok: true, status: 'suspended' });
    expect((await pg.query(`select status, lifecycle_state, suspension_reason_code from tenants where id = $1`, [S])).rows[0])
      .toEqual({ status: 'suspended', lifecycle_state: 'SUSPENDED', suspension_reason_code: 'BILLING' });
  });
  it('closing then archiving: CLOSED clears the code, ARCHIVED is final', async () => {
    expect(await svc.changeLifecycle(S, 'CLOSED', 'owner asked to close the account')).toMatchObject({ ok: true, status: 'cancelled' });
    expect((await pg.query(`select suspension_reason_code from tenants where id = $1`, [S])).rows[0].suspension_reason_code).toBeNull();
    // §21: not before the retention period, and not while a legal hold covers the salon
    expect(await svc.changeLifecycle(S, 'ARCHIVED', 'retention period complete')).toMatchObject({ ok: false, errors: [expect.stringMatching(/kept for 90 days/)] });
    expect((await pg.query(`select closed_at from tenants where id = $1`, [S])).rows[0].closed_at).toBeTruthy();
    await pg.query(`update tenants set closed_at = now() - interval '91 days' where id = $1`, [S]);
    await seedRow(pg, 'audit_legal_holds', { hold_ref: 'LH-TEST-1', scope_type: 'tenant', scope_value: S, reason: 'litigation', status: 'active' });
    expect(await svc.changeLifecycle(S, 'ARCHIVED', 'retention period complete')).toMatchObject({ ok: false, errors: [expect.stringMatching(/legal hold/)] });
    await pg.query(`update audit_legal_holds set status = 'released', released_at = now() where hold_ref = 'LH-TEST-1'`);
    expect(await svc.changeLifecycle(S, 'ARCHIVED', 'retention period complete')).toMatchObject({ ok: true });
    expect((await pg.query(`select lifecycle_state, closed_at from tenants where id = $1`, [S])).rows[0].closed_at).toBeTruthy();   // kept through ARCHIVED
    expect(await svc.changeLifecycle(S, 'ACTIVE', 'bring it back please')).toMatchObject({ ok: false });
  });
});

// ── §20: reactivation policy validation ──────────────────────────────────────────────────────────────────────────────
import { platformPermissionsFor } from '@aipowersalon/permissions';
describe('reactivation validation (§20, real schema)', () => {
  const F = '6c6c6c6c-6c6c-46c6-86c6-6c6c6c6c6c6c';
  let db2: any; let svc2: any;
  beforeAll(async () => {
    db2 = kyselyFor(pg);
    await seedRow(pg, 'tenants', { id: F, legal_name: 'F', display_name: 'Fraud Case', tenant_slug: 'fraudcase', tenant_code: 'FRAU01', status: 'active' });
    await seedRow(pg, 'integration_connections', { tenant_id: F, provider_key: 'twilio', connection_status: 'compromised' });
    svc2 = new SuperAdminTenantsService(new KyselySuperAdminTenantsRepo(db2));
    expect(await svc2.changeLifecycle(F, 'SUSPENDED', 'chargeback ring detected', 'FRAUD')).toMatchObject({ ok: true });
  });
  it('an admin without the security permission cannot reactivate a FRAUD suspension; the salon stays suspended', async () => {
    const admin = { userId: '6e6e6e6e-6e6e-46e6-86e6-6e6e6e6e6e6e', permissions: platformPermissionsFor('PLATFORM_ADMIN') as string[] };
    expect(await svc2.changeLifecycle(F, 'ACTIVE', 'investigation closed today', undefined, admin)).toMatchObject({ ok: false, errors: [expect.stringMatching(/security permission/)] });
    expect(await svc2.changeStatus(F, 'active', 'investigation closed today', admin)).toMatchObject({ ok: false });
    expect((await pg.query(`select status from tenants where id = $1`, [F])).rows[0].status).toBe('suspended');
  });
  it('a Super Admin can; the compromised integration stays disabled and is reported', async () => {
    const sa = { userId: '6d6d6d6d-6d6d-46d6-86d6-6d6d6d6d6d6d', permissions: platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[] };
    const r = await svc2.changeLifecycle(F, 'ACTIVE', 'investigation closed today', undefined, sa);
    expect(r).toMatchObject({ ok: true, status: 'active', warnings: [expect.stringMatching(/1 integration\(s\) disabled as compromised stay disabled/)] });
    expect((await pg.query(`select connection_status from integration_connections where tenant_id = $1`, [F])).rows[0].connection_status).toBe('compromised');
  });
});
