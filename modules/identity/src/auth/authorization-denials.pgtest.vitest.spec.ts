// authorization-denials.pgtest.vitest.spec.ts — BUILD_PLAN Phase 9: denials are recorded, sampled to one row per salon + user +
// key + reason per minute, folded in memory inside a burst, and never fail the caller.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyAuthzDenialSink } from './authorization-denials';

const T = 'ad900000-0000-4000-8000-0000000000a1'; const U = 'ad900000-0000-4000-8000-0000000000c1';
let db: any;
beforeAll(async () => { db = kyselyFor(await migratedPglite()); }, 120_000);
const rows = async () => (await sql`select permission, reason, count, route, role from authorization_denials where tenant_id = ${T} order by permission, reason`.execute(db) as any).rows;

describe('authorization denial sink', () => {
  it('one row per user + key + reason within a minute; the count grows; another reason is another row', async () => {
    let now = 1_000_000;
    const sink = new KyselyAuthzDenialSink(db, 0, () => now);
    const d = { tenantId: T, userId: U, role: 'FRONT_DESK', permission: 'reports.export', reason: 'missing_permission', route: '/pos/reports/export' };
    await sink.write(d); now += 10; await sink.write(d); now += 10; await sink.write(d);
    await sink.write({ ...d, reason: 'denied_by_override' });
    expect(await rows()).toEqual([
      { permission: 'reports.export', reason: 'denied_by_override', count: 1, route: '/pos/reports/export', role: 'FRONT_DESK' },
      { permission: 'reports.export', reason: 'missing_permission', count: 3, route: '/pos/reports/export', role: 'FRONT_DESK' },
    ]);
  });
  it('a burst inside the gap is folded in memory and written with the next write', async () => {
    let now = 5_000_000;
    const sink = new KyselyAuthzDenialSink(db, 2_000, () => now);
    const d = { tenantId: T, userId: U, role: 'FRONT_DESK', permission: 'customers.export', reason: 'missing_permission', route: null };
    await sink.write(d); await sink.write(d); await sink.write(d);   // 2 folded
    expect((await rows()).find((r: any) => r.permission === 'customers.export').count).toBe(1);
    now += 2_001; await sink.write(d);                              // 1 + the 2 folded
    expect((await rows()).find((r: any) => r.permission === 'customers.export').count).toBe(4);
  });
  it('non-uuid ids become null; a failing database never throws out of record()', async () => {
    const sink = new KyselyAuthzDenialSink(db, 0);
    await sink.write({ tenantId: 'not-a-uuid', userId: 'system:x', role: 'SYSTEM', permission: 'p.q', reason: 'missing_permission', route: null });
    const r: any = (await sql`select tenant_id, user_id from authorization_denials where permission = 'p.q'`.execute(db)).rows[0];
    expect(r).toEqual({ tenant_id: null, user_id: null });
    const broken = new KyselyAuthzDenialSink({ executeQuery: () => { throw new Error('db down'); } } as any, 0);
    expect(() => broken.record({ tenantId: T, userId: U, role: null, permission: 'x', reason: 'y', route: null })).not.toThrow();
  });
});
