// integrity-checks.pgtest — Constitution 11 §121, §205–209: crossed salon ids in real data, found and reported.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { IntegrityChecks, INVARIANTS, evaluateIntegrity, lastIntegrityRun, resetIntegrityRun, CHECK_EVERY_MS } from './integrity-checks';
import { rollup, COMPONENTS } from './health-core';
import { desiredAlerts } from './alert-rules';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const TA = 'c1c1c1c1-0000-4000-8000-00000000000a', TB = 'c1c1c1c1-0000-4000-8000-00000000000b';
const BA = 'c2c2c2c2-0000-4000-8000-00000000000a', BB = 'c2c2c2c2-0000-4000-8000-00000000000b';
const CA = 'c3c3c3c3-0000-4000-8000-00000000000a', CB = 'c3c3c3c3-0000-4000-8000-00000000000b';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [t, code] of [[TA, 'INTA1'], [TB, 'INTB1']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', '${code}', '${code.toLowerCase()}', '${code}', 'active') ON CONFLICT DO NOTHING`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A main'), ('${BB}', '${TB}', 'B main') ON CONFLICT DO NOTHING`);
  await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CA}', '${TA}', '${BA}', 'Ann', 'A', 'Ann A'), ('${CB}', '${TB}', '${BB}', 'Bea', 'B', 'Bea B') ON CONFLICT DO NOTHING`);
});
beforeEach(async () => { await pg.exec(`DELETE FROM tickets WHERE tenant_id IN ('${TA}', '${TB}')`); resetIntegrityRun(); });
// Constitution 12 migration 450 now REFUSES a crossed write. Detection still matters for rows written BEFORE that
// trigger existed, so crossed fixtures are written as LEGACY data: session_replication_role = replica skips triggers
// for this one insert only — the way a pre-450 row got there. A clean ticket goes through the trigger normally.
const ticket = async (tenant: string, branch: string, customer: string) => {
  await pg.exec(`SET session_replication_role = replica`);
  try { return (await pg.query(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [tenant, branch, customer])).rows[0].id; }
  finally { await pg.exec(`SET session_replication_role = DEFAULT`); }
};
const find = (id: string) => INVARIANTS.find((i) => i.id === id)!;

describe('every invariant is real', () => {
  it('each child table, column and parent exists and both sides carry tenant_id — a typo would check nothing, forever', async () => {
    for (const inv of INVARIANTS) {
      const has = async (t: string, c: string) => (await pg.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [t, c])).rows.length > 0;
      expect(await has(inv.child, inv.column), `${inv.id}: ${inv.child}.${inv.column}`).toBe(true);
      expect(await has(inv.child, 'tenant_id'), `${inv.id}: ${inv.child}.tenant_id`).toBe(true);
      expect(await has(inv.parent, 'tenant_id'), `${inv.id}: ${inv.parent}.tenant_id`).toBe(true);
    }
  });
  it('every check RUNS against the real schema without error', async () => {
    const results = await new IntegrityChecks(db).runAll();
    expect(results.filter((r) => r.error)).toEqual([]);
    expect(results).toHaveLength(INVARIANTS.length);
  });
});

describe('§121 finding crossed salon ids', () => {
  it('clean data: zero violations', async () => {
    await ticket(TA, BA, CA);
    expect((await new IntegrityChecks(db).check(find('ticket_customer'))).violations).toBe(0);
  });
  it('a salon-A ticket charging salon B\'s customer is found — with the offending row id for the investigator', async () => {
    const bad = await ticket(TA, BA, CB);
    const r = await new IntegrityChecks(db).check(find('ticket_customer'));
    expect(r.violations).toBe(1);
    expect(r.sampleIds).toEqual([bad]);
  });
  it('a crossed BRANCH is found by its own invariant', async () => {
    await ticket(TA, BB, CA);
    expect((await new IntegrityChecks(db).check(find('ticket_branch'))).violations).toBe(1);
    expect((await new IntegrityChecks(db).check(find('ticket_customer'))).violations).toBe(0);
  });
  it('it DETECTS and never repairs (§209): the offending row is untouched', async () => {
    const bad = await ticket(TA, BA, CB);
    await new IntegrityChecks(db).runAll();
    expect((await pg.query(`SELECT tenant_id, customer_id FROM tickets WHERE id = $1`, [bad])).rows[0]).toEqual({ tenant_id: TA, customer_id: CB });
  });
  it('one check failing (a missing table) does not stop the others', async () => {
    const s = new IntegrityChecks(db);
    const r = await s.check({ id: 'zz', child: 'no_such_table', column: 'x_id', parent: 'customers', why: '' });
    expect(r.error).toBeTruthy();
    await ticket(TA, BA, CB);
    expect((await s.check(find('ticket_customer'))).violations).toBe(1);
  });
});

describe('§208 severity and where it shows', () => {
  it('any violation is an OUTAGE of a CRITICAL component — a P1 page', async () => {
    await ticket(TA, BA, CB);
    await new IntegrityChecks(db).runAll(1_000_000);
    const e = evaluateIntegrity(lastIntegrityRun(), 1_000_000);
    expect(e).toMatchObject({ status: 'OUTAGE', reason: expect.stringContaining('ticket_customer') });
    const [a] = desiredAlerts([{ key: 'data_integrity', name: 'Data Integrity', status: e.status, reason: e.reason, criticality: 'CRITICAL', owner: 'o', runbook: 'r' }]);
    expect(a.severity).toBe('critical');
  });
  it('…but it never takes the PLATFORM status down: salons can still work while it is investigated', () => {
    const def = COMPONENTS.find((c) => c.key === 'data_integrity')!;
    expect(def.availability).toBe(false);
    expect(rollup([{ key: 'api', status: 'HEALTHY', criticality: 'CRITICAL' }, { key: 'data_integrity', status: 'OUTAGE', criticality: 'CRITICAL', availability: false }])).toBe('HEALTHY');
  });
  it('not run yet, or stale, is UNKNOWN — never "no violations"', () => {
    expect(evaluateIntegrity(null, 0).status).toBe('UNKNOWN');
    expect(evaluateIntegrity({ at: 0, results: [] }, 4 * CHECK_EVERY_MS).reason).toBe('stale');
  });
  it('a check that could not run degrades the component rather than hiding', () => {
    expect(evaluateIntegrity({ at: 0, results: [{ id: 'x', violations: 0, capped: false, error: 'timeout', sampleIds: [] }] }, 1).status).toBe('DEGRADED');
  });
});

describe('NULL is never a mismatch — for invariants over nullable tables', () => {
  // Every table in INVARIANTS has tenant_id NOT NULL, so a mutation treating NULL as a mismatch survived every test
  // above: the case cannot occur there. The guard exists for the next invariant added over a nullable table, so it is
  // proven on real ones: alerts.tenant_id and users.tenant_id are nullable, and platform rows legitimately use NULL.
  it('a platform alert (no salon) assigned to a salon user is not reported as crossing salons', async () => {
    const U = 'c4c4c4c4-0000-4000-8000-00000000000a';
    await pg.exec(`DELETE FROM alerts WHERE dedupe_key = 'int-null'; DELETE FROM users WHERE id = '${U}';
      INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${U}', '${TA}', 'Ann', 'ann-int@x.test', 'x', 'active', 'MANAGER');
      INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, assigned_to_user_id, dedupe_key) VALUES (NULL, 'Platform', 't', 'm', 'system', 'low', 'unread', '${U}', 'int-null')`);
    const r = await new IntegrityChecks(db).check({ id: 'alert_assignee', child: 'alerts', column: 'assigned_to_user_id', parent: 'users', why: '' });
    expect(r.error).toBeNull();
    expect(r.violations).toBe(0);
  });
});
