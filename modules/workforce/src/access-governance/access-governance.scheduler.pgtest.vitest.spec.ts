// BUILD_PLAN Phase 9 — the dormant-account job: an hourly tick does the work once per UTC day, single-owner, and asks
// the service for each salon with a dormant account.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DormantAccountScheduler, dormantAlertsEnabled, utcDay } from './access-governance.module';

let db: any;
beforeAll(async () => { db = kyselyFor(await migratedPglite()); }, 120_000);

describe('DormantAccountScheduler', () => {
  it('runs once per UTC day, over every salon the service names', async () => {
    const calls: string[] = [];
    const svc: any = { tenantsWithDormant: async () => ['t1', 't2'], alertDormantForTenant: async (t: string) => { calls.push(t); return 1; } };
    const s = new DormantAccountScheduler(db, svc);
    const day1 = Date.parse('2026-10-08T03:00:00Z');
    expect(await s.tick(day1)).toBe(2);
    expect(await s.tick(day1 + 3_600_000)).toBe(0);              // same UTC day: nothing
    expect(await s.tick(Date.parse('2026-10-09T00:30:00Z'))).toBe(2);   // next day: again
    expect(calls).toEqual(['t1', 't2', 't1', 't2']);
  });
  it('one salon failing does not stop the others', async () => {
    const svc: any = { tenantsWithDormant: async () => ['bad', 'good'], alertDormantForTenant: async (t: string) => { if (t === 'bad') throw new Error('x'); return 3; } };
    expect(await new DormantAccountScheduler(db, svc).runOnce()).toBe(3);
  });
  it('switch and day helper', () => {
    expect(dormantAlertsEnabled({} as any)).toBe(true);
    expect(dormantAlertsEnabled({ AUTHZ_DORMANT_ALERTS: 'off' } as any)).toBe(false);
    expect(utcDay(Date.parse('2026-10-08T23:59:59Z'))).toBe('2026-10-08');
  });
});
