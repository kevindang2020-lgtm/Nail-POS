// tenant-health-snapshots.pgtest — Constitution 11 §344 (hourly per-salon snapshot) + §156 (the all-salon list), on the
// real migrated schema: every ACTIVE salon gets one row per hour (a second sweep in the same hour is a no-op), inactive
// salons are skipped, realtime stays NULL (not measured, never a guessed HEALTHY), and the list returns the LATEST row per
// salon, worst first.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TenantHealthService, TenantHealthSnapshots, sortHealthRows, type TenantHealthRow } from './tenant-health';
import { seedRow } from '../events/pgtest-seed';

const A = '4a4a4a4a-4a4a-44a4-84a4-4a4a4a4a4a4a', Bt = '4b4b4b4b-4b4b-44b4-84b4-4b4b4b4b4b4b', C = '4c4c4c4c-4c4c-44c4-84c4-4c4c4c4c4c4c';
let db: any; let snaps: TenantHealthSnapshots;

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: A, legal_name: 'A', display_name: 'Alpha Nails', tenant_slug: 'alphanails', tenant_code: 'ALPH01', status: 'active' });
  await seedRow(pg, 'tenants', { id: Bt, legal_name: 'B', display_name: 'Bravo Spa', tenant_slug: 'bravospa', tenant_code: 'BRAV01', status: 'active' });
  await seedRow(pg, 'tenants', { id: C, legal_name: 'C', display_name: 'Closed Salon', tenant_slug: 'closedsalon', tenant_code: 'CLOS01', status: 'cancelled' });
  // Bravo has a payment gateway that is not active -> a real, non-UNKNOWN payments state
  await seedRow(pg, 'tenant_payment_config', { tenant_id: Bt, processor: 'fiserv', environment: 'sandbox', status: 'pending', merchant_id: 'MID-B' });
  snaps = new TenantHealthSnapshots(new TenantHealthService(db), db);
});

describe('§344 hourly tenant health snapshots', () => {
  it('stores one row per ACTIVE salon; a second sweep in the same hour stores nothing more; realtime is NULL', async () => {
    const now = new Date('2026-09-27T10:15:00Z');
    const first = await snaps.sweep(now);
    const again = await snaps.sweep(new Date('2026-09-27T10:40:00Z'));
    expect(first).toMatchObject({ salons: 2, stored: 2, failed: 0 });
    expect(again).toMatchObject({ salons: 2, stored: 0, failed: 0 });   // a same-hour re-run is a clean no-op, not 2 swallowed errors
    const rows = (await sql<any>`select tenant_id, snapshot_hour, realtime_status, overall_status from tenant_health_snapshots order by tenant_id`.execute(db)).rows;
    expect(rows.map((r) => r.tenant_id)).toEqual([A, Bt]);                 // the cancelled salon is not snapshotted
    expect(rows.every((r) => r.realtime_status === null)).toBe(true);
    expect(new Date(rows[0].snapshot_hour).toISOString()).toBe('2026-09-27T10:00:00.000Z');
  });
  it('the next hour adds a row; the list shows only the LATEST per salon, worst first', async () => {
    await snaps.sweep(new Date('2026-09-27T11:05:00Z'));
    expect(Number((await sql<any>`select count(*)::int n from tenant_health_snapshots`.execute(db)).rows[0].n)).toBe(4);
    const { rows } = await snaps.list('worst');
    expect(rows.map((r) => r.tenantId)).toHaveLength(2);
    expect(rows.every((r) => r.observedAt === '2026-09-27T11:05:00.000Z')).toBe(true);
    expect(rows[0].tenantName).toBe('Bravo Spa');                             // its payments are not healthy
    expect(rows[0].components.payments).not.toBe('HEALTHY');
    const byName = await snaps.list('name');
    expect(byName.rows.map((r) => r.tenantName)).toEqual(['Alpha Nails', 'Bravo Spa']);
  });
});

describe('sortHealthRows', () => {
  const row = (id: string, name: string, overall: any, observedAt = '2026-09-27T11:00:00Z'): TenantHealthRow =>
    ({ tenantId: id, tenantName: name, observedAt, overall, components: { payments: overall, messaging: 'HEALTHY', booking: 'HEALTHY', devices: 'HEALTHY', jobs: 'HEALTHY' }, realtime: null, failedQueries: [] });
  it('worst first: OUTAGE > MISCONFIGURED > DEGRADED > RATE_LIMITED > not in use > HEALTHY; ties by name', () => {
    const out = sortHealthRows([row('1', 'Zed', 'HEALTHY'), row('2', 'Amy', 'UNKNOWN'), row('3', 'Bob', 'OUTAGE'), row('4', 'Cal', 'DEGRADED'), row('5', 'Ann', 'DEGRADED'), row('6', 'Dan', 'MISCONFIGURED')]);
    expect(out.map((r) => r.tenantName)).toEqual(['Bob', 'Dan', 'Ann', 'Cal', 'Amy', 'Zed']);
  });
  it("'observed' puts the stalest snapshot first", () => {
    const out = sortHealthRows([row('1', 'New', 'HEALTHY', '2026-09-27T11:00:00Z'), row('2', 'Old', 'HEALTHY', '2026-09-27T08:00:00Z')], 'observed');
    expect(out.map((r) => r.tenantName)).toEqual(['Old', 'New']);
  });
});

describe('§290 — the list is paged in the database', () => {
  it('pages with an opaque cursor, keeps the worst-first order across pages, and counts every salon', async () => {
    const first = await snaps.list('worst', undefined, { limit: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.total).toBe(2);
    expect(first.rows[0].tenantName).toBe('Bravo Spa');                     // worst first, as before
    expect(first.nextCursor).toBeTruthy();
    const second = await snaps.list('worst', undefined, { limit: 1, cursor: first.nextCursor });
    expect(second.rows.map((r) => r.tenantName)).toEqual(['Alpha Nails']);
    expect(second.nextCursor).toBeNull();
    expect(Object.values(first.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0)).toBe(2);
  });
  // Constitution 5 §46 (Oct 2026) supersedes "a garbage cursor starts at the top": the salon-health screen APPENDS each
  // page, so silently restarting at 0 duplicated every salon. A garbage cursor is now a 400; a pre-Oct {o} cursor still works.
  it('a filter is applied in the database and the total reflects it; a garbage cursor is refused, a legacy cursor still pages', async () => {
    const r = await snaps.list('worst', 'HEALTHY', { limit: 10 });
    expect(r.rows.every((x) => x.overall === 'HEALTHY')).toBe(true);
    expect(r.total).toBe(r.rows.length);
    await expect(snaps.list('name', undefined, { limit: 1, cursor: 'not-a-cursor' })).rejects.toMatchObject({ status: 400 });
    const legacy = Buffer.from(JSON.stringify({ o: 1 })).toString('base64url');
    const viaShared = (await snaps.list('name', undefined, { limit: 1 })).nextCursor!;
    expect((await snaps.list('name', undefined, { limit: 1, cursor: legacy })).rows[0].tenantName)
      .toBe((await snaps.list('name', undefined, { limit: 1, cursor: viaShared })).rows[0].tenantName);
  });
});
