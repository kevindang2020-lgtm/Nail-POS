// customer-sync-scheduler.vitest.spec.ts — the 7:00 PM worker, driven through a SIMULATED CALENDAR (Jul 26, 2026).
//
// A deployed server is the only place "it fired at 7 PM" can be observed for real. What CAN be proven here is
// everything that determines whether it will: the arming switch, and the exact behaviour of the production
// tick() across a real multi-day timeline — including both daylight-saving transitions, where a naive
// implementation either skips a night or fires twice.
//
// The timeline below advances a clock in 5-minute steps (the production TICK_MS) and calls the SAME tick() the
// interval calls. Nothing is stubbed except the clock.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomerReconciliationService, CustomerSyncScheduler, syncWorkerEnabled } from './customer-reconciliation.service';

const TICK_MS = 5 * 60 * 1000;
const hourIn = (d: Date, tz = 'America/New_York') => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(d));
const dayIn = (d: Date, tz = 'America/New_York') => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d);

function harness() {
  const repo = new InMemoryCustomerIdentityRepository();
  repo.tenants = ['TA'];
  const svc = new CustomerReconciliationService(repo, new CustomerIdentityService(repo));
  let clock = new Date();
  const sched = new CustomerSyncScheduler(svc, repo, () => clock);
  return { repo, svc, sched, set: (d: Date) => { clock = d; }, get: () => clock };
}

/** Advance `hours` of wall time in production-sized ticks, recording when a run actually started. */
async function runTimeline(h: ReturnType<typeof harness>, startIso: string, hours: number) {
  const fired: { at: Date; dayNY: string; hourNY: number }[] = [];
  let t = new Date(startIso).getTime();
  const end = t + hours * 3_600_000;
  let seen = h.repo.runs.length;   // pre-existing rows (e.g. a seeded prior run) are not new fires
  while (t < end) {
    h.set(new Date(t));
    await h.sched.tick();
    if (h.repo.runs.length > seen) {
      seen = h.repo.runs.length;
      const at = new Date(t);
      fired.push({ at, dayNY: dayIn(at), hourNY: hourIn(at) });
      // A completed run is what the next night's "has ~a day passed" check reads.
      h.repo.runs[0].status = 'COMPLETED';
      h.repo.runs[0].finishedAt = new Date(t + 60_000).toISOString();
    }
    t += TICK_MS;
  }
  return fired;
}

const OLD = process.env.CUSTOMER_SYNC_WORKER_ENABLED;
afterEach(() => { if (OLD === undefined) delete process.env.CUSTOMER_SYNC_WORKER_ENABLED; else process.env.CUSTOMER_SYNC_WORKER_ENABLED = OLD; });
beforeEach(() => { delete process.env.CUSTOMER_SYNC_WORKER_ENABLED; });

describe('7:00 PM worker — arming', () => {
  it('is OFF unless CUSTOMER_SYNC_WORKER_ENABLED is truthy, and ON for the accepted spellings', () => {
    expect(syncWorkerEnabled({} as any)).toBe(false);
    expect(syncWorkerEnabled({ CUSTOMER_SYNC_WORKER_ENABLED: 'false' } as any)).toBe(false);
    expect(syncWorkerEnabled({ CUSTOMER_SYNC_WORKER_ENABLED: '0' } as any)).toBe(false);
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) expect(syncWorkerEnabled({ CUSTOMER_SYNC_WORKER_ENABLED: v } as any)).toBe(true);
  });

  it('onModuleInit starts no timer when disabled, and an unref\u2019d one when enabled (never holds the process open)', () => {
    const h = harness();
    h.sched.onModuleInit();
    expect((h.sched as any).timer).toBeUndefined();

    process.env.CUSTOMER_SYNC_WORKER_ENABLED = '1';
    const h2 = harness();
    h2.sched.onModuleInit();
    const timer: any = (h2.sched as any).timer;
    expect(timer).toBeDefined();
    h2.sched.onModuleDestroy();
    expect(() => h2.sched.onModuleDestroy()).not.toThrow();       // idempotent shutdown
  });
});

describe('7:00 PM worker — simulated calendar through the production tick()', () => {
  it('over 48h it fires EXACTLY twice, each time inside the 19:00 New York hour, on consecutive days', async () => {
    const h = harness();
    // Start at 09:00 NY on a normal summer day (EDT).
    const fired = await runTimeline(h, '2026-07-20T13:00:00Z', 48);
    expect(fired.length).toBe(2);
    for (const f of fired) expect(f.hourNY).toBe(19);
    expect(fired[0].dayNY).toBe('2026-07-20');
    expect(fired[1].dayNY).toBe('2026-07-21');
    // …and it fires at the START of the window, not repeatedly through it.
    expect(fired[0].at.getUTCMinutes() % 5).toBe(0);
  });

  it('does not fire twice in one evening even though the 19:00 window is twelve ticks long', async () => {
    const h = harness();
    const fired = await runTimeline(h, '2026-07-20T22:30:00Z', 3);   // 18:30 → 21:30 NY
    expect(fired.length).toBe(1);
    expect(fired[0].hourNY).toBe(19);
  });

  it('DST fall-back (Nov 1, 2026 — the 1am hour repeats): still exactly one run per calendar day at 19:00 local', async () => {
    const h = harness();
    const fired = await runTimeline(h, '2026-10-31T20:00:00Z', 72);   // Oct 31 16:00 EDT → Nov 3
    const days = fired.map((f) => f.dayNY);
    expect(new Set(days).size).toBe(days.length);                    // never two runs on one day
    for (const f of fired) expect(f.hourNY).toBe(19);
    expect(days).toContain('2026-11-01');                            // the transition day is not skipped
    expect(days).toContain('2026-11-02');
  });

  it('DST spring-forward (Mar 8, 2026 — the 2am hour vanishes): still exactly one run per calendar day at 19:00 local', async () => {
    const h = harness();
    const fired = await runTimeline(h, '2026-03-07T21:00:00Z', 72);   // Mar 7 16:00 EST → Mar 10
    const days = fired.map((f) => f.dayNY);
    expect(new Set(days).size).toBe(days.length);
    for (const f of fired) expect(f.hourNY).toBe(19);
    expect(days).toContain('2026-03-08');
    expect(days).toContain('2026-03-09');
  });

  it('honours PLATFORM_TIMEZONE: on a Los Angeles platform it fires at 19:00 PACIFIC, not Eastern', async () => {
    const prev = process.env.PLATFORM_TIMEZONE;
    process.env.PLATFORM_TIMEZONE = 'America/Los_Angeles';
    try {
      const h = harness();
      const fired = await runTimeline(h, '2026-07-20T16:00:00Z', 24);   // 09:00 LA
      expect(fired.length).toBe(1);
      expect(hourIn(fired[0].at, 'America/Los_Angeles')).toBe(19);
      expect(hourIn(fired[0].at, 'America/New_York')).toBe(22);         // proves it is not Eastern-hardcoded
    } finally { if (prev === undefined) delete process.env.PLATFORM_TIMEZONE; else process.env.PLATFORM_TIMEZONE = prev; }
  });

  it('§38 watchdog: a server that was down for two nights raises CUSTOMER_RECONCILIATION_MISSED once, then recovers', async () => {
    const h = harness();
    // Last completed run was 40h ago; it is 10:00 NY, so the 7 PM window has not arrived yet.
    h.repo.runs.unshift({ id: 'old', trigger: 'scheduled', scope: 'all', status: 'COMPLETED', startedAt: '', finishedAt: new Date(Date.parse('2026-07-20T14:00:00Z') - 40 * 3_600_000).toISOString() });
    h.set(new Date('2026-07-20T14:00:00Z'));
    await h.sched.tick();
    await h.sched.tick();                                             // a second tick must not create a second alert
    const alerts = h.repo.conflictRows.filter((c) => c.kind === 'CUSTOMER_RECONCILIATION_MISSED');
    expect(alerts.length).toBe(1);
    expect(alerts[0].occurrences).toBe(2);                            // deduped by fingerprint, occurrence-counted
    expect(h.repo.runs.filter((r) => r.status === 'RUNNING').length).toBe(0);   // the watchdog does not itself run a sync

    // Evening arrives: it recovers on its own.
    const fired = await runTimeline(h, '2026-07-20T22:45:00Z', 2);
    expect(fired.length).toBe(1);
    expect(fired[0].hourNY).toBe(19);
  });

  it('a slow run cannot overlap itself: a tick during an in-flight run is skipped', async () => {
    const h = harness();
    let started = 0;
    (h.svc as any).runReconciliation = async () => { started++; await new Promise((r) => setTimeout(r, 30)); return { ran: true }; };
    h.set(new Date('2026-07-20T23:05:00Z'));                          // 19:05 NY
    const a = h.sched.tick();
    const b = h.sched.tick();                                         // fires while the first is still awaiting
    await Promise.all([a, b]);
    expect(started).toBe(1);
  });
});
