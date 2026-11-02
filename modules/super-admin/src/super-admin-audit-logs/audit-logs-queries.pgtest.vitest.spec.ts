// audit-logs-queries.pgtest — executes the Super Admin Audit Logs queries against the real migrated schema.
//
// 19 queries behind the usual two swallowing helpers (rows() → [], one() → all-zeros). The failure mode here
// is the worst in the codebase: an audit surface that reports **no failed logins, no data exports, no role
// changes and no support access** does not look broken. It looks CLEAN. Nobody escalates a clean audit log,
// which is precisely the screen an investigator would be relying on.
//
// Every assertion is "NOT zero / NOT empty", and the seeded events are deliberately the ones that matter:
// a failed login, a data export, a role change and support access.
import { describe, it, expect, beforeAll } from 'vitest';
import { AuditLogsRepository } from './audit-logs.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'a1a1a1a1-0000-4000-8000-000000000001';
const range = { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000) } as never;
const scope = { tenantId: T };
let repo: AuditLogsRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Audit Salon LLC', 'Audit Salon', 'audit-salon', 'AUDIT1', 'active') ON CONFLICT DO NOTHING;
  `);
  repo = new AuditLogsRepository(kyselyFor(pg) as never);

  // One event per KPI the counts() query filters on. Each filter is a separate `count(*) filter (where ...)`,
  // so a single seeded row would leave most of them at 0 and prove nothing.
  await pg.exec(`
    INSERT INTO audit_events (tenant_id, actor_name, module, action, status, severity) VALUES
      ('${T}', 'Dana Reed', 'auth',        'user.login',          'failed',  'high'),
      ('${T}', 'Dana Reed', 'reports',     'report.export',       'success', 'medium'),
      ('${T}', 'Dana Reed', 'users',       'user.role_changed',   'success', 'critical'),
      ('${T}', 'Dana Reed', 'support',     'support.session_started', 'success', 'medium'),
      ('${T}', 'Dana Reed', 'ai-platform', 'ai.config_updated',   'success', 'low');
  `);
});

describe('the audit KPI counts execute — "all zeros" here looks CLEAN, not broken', () => {
  it('a failed login is counted', async () => {
    const c = await repo.counts(scope, range);
    expect(Number(c.failed_logins)).toBeGreaterThan(0);
  });

  it('a data export is counted', async () => {
    const c = await repo.counts(scope, range);
    expect(Number(c.data_exports)).toBeGreaterThan(0);
  });

  it('a role change is counted', async () => {
    const c = await repo.counts(scope, range);
    expect(Number(c.role_changes)).toBeGreaterThan(0);
  });

  it('support access is counted — the module OR action branch has to work', async () => {
    const c = await repo.counts(scope, range);
    expect(Number(c.support_access)).toBeGreaterThan(0);
  });

  it('an AI config change is counted — both halves of that AND predicate', async () => {
    const c = await repo.counts(scope, range);
    expect(Number(c.ai_config)).toBeGreaterThan(0);
  });

  it('high/critical severity rolls up to the critical count', async () => {
    const c = await repo.counts(scope, range);
    expect(Number(c.critical)).toBeGreaterThanOrEqual(2);
  });

  it('the total counts every seeded event', async () => {
    const c = await repo.counts(scope, range);
    expect(Number(c.total)).toBeGreaterThanOrEqual(5);
  });
});

describe('the breakdowns and the trail return rows', () => {
  it('byCategory groups by module', async () => {
    const r = await repo.byCategory(scope, range);
    expect(r.length).toBeGreaterThan(0);
    expect(r.map((x) => x.module)).toContain('auth');
  });

  it('byResult groups by status and sees the failure', async () => {
    const r = await repo.byResult(scope, range);
    expect(r.map((x) => x.status)).toContain('failed');
  });

  it('byDay buckets the events', async () => {
    const r = await repo.byDay(scope, range);
    expect(r.length).toBeGreaterThan(0);
  });

  it('topUsers names the actor — an empty list reads as "nobody did anything"', async () => {
    const r = await repo.topUsers(scope, range);
    expect(JSON.stringify(r)).toContain('Dana Reed');
  });

  it('the trail returns the events themselves', async () => {
    const r = await repo.trail(scope, range);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('tenant scoping', () => {
  it('another tenant sees an empty audit trail, not this one', async () => {
    const r = await repo.trail({ tenantId: 'b2b2b2b2-0000-4000-8000-000000000002' }, range);
    expect(r).toHaveLength(0);
  });

  it('…and zero counts', async () => {
    const c = await repo.counts({ tenantId: 'b2b2b2b2-0000-4000-8000-000000000002' }, range);
    expect(Number(c.total)).toBe(0);
  });
});
