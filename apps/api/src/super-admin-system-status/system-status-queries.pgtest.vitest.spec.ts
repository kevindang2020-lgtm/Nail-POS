// system-status-queries.pgtest — executes the Super Admin system-status repository against the REAL schema.
//
// Second module from the silent-SQL report (scripts/audit-silent-sql.mjs): 11 error-swallowing catches. A
// broken query here is especially bad — the platform status surface would report nothing wrong while showing
// nothing at all, which reads as "all clear" rather than "the status feed is broken".
//
// Pattern: apply every real db/migrations file to PGlite, then insert fixtures. Schema truth comes from the
// migrations, never from hand-written DDL that could drift.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselySystemStatusRepo } from './system-status.kysely.repository';
// Shared, cached migrated schema — built once, reused by every pgtest (@aipowersalon/testing (packages/testing/src/pgtest-schema.mjs)).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let repo: KyselySystemStatusRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO status_components (key, name, status, sort_order)
      VALUES ('api','API Gateway','operational',1), ('db','Database','degraded',2)
      ON CONFLICT (key) DO NOTHING;
  `);
  const db = kyselyFor(pg);
  repo = new KyselySystemStatusRepo(db);
}, 60_000);

describe('system-status repository executes against the real migrated schema', () => {
  it('components() returns the seeded rows — [] is how a broken status feed hides', async () => {
    const rows = await repo.components();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r: any) => r.key)).toEqual(expect.arrayContaining(['api', 'db']));
  });

  it('every read path executes and returns the right container type', async () => {
    expect(Array.isArray(await repo.incidents())).toBe(true);
    expect(Array.isArray(await repo.scheduledMaintenance())).toBe(true);
    expect(Array.isArray(await repo.publicUpdates())).toBe(true);
    expect(Array.isArray(await repo.incidentHistory())).toBe(true);
    expect(typeof await repo.incidentReportsThisMonth()).toBe('number');
  });

  // Two DIFFERENT vocabularies on the same row, easy to mix up (both surfaced by writing this test):
  //   impact   ∈ none | minor | major | critical          (migration 147)
  //   severity ∈ critical | high | medium | low | informational  (migration 247)
  // 'minor' is a valid impact but NOT a valid severity. createIncident does not catch, so a bad value is a
  // loud 500 rather than a silent no-op — but the caller still needs the right word.
  it('createIncident → updateIncidentStatus round-trips through real tables', async () => {
    const created = await repo.createIncident({ title: 'SMS delivery delay', componentKey: 'api', severity: 'medium', impact: 'minor', affectedTenants: 3 });
    expect(created).toBeTruthy();
    expect((created as any).id).toBeTruthy();
    const updated = await repo.updateIncidentStatus((created as any).id, 'resolved');
    expect(updated).not.toBeNull();                       // null = the UPDATE silently failed
    const list = await repo.incidents();
    expect(list.some((i: any) => i.title === 'SMS delivery delay')).toBe(true);
  });
});
