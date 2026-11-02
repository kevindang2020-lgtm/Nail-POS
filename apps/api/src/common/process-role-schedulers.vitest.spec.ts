// process-role-schedulers — Constitution 13 Phase 8: a background scheduler starts ONLY where its process role allows.
// The pure switch is unit-tested in @aipowersalon/config; this proves real schedulers obey it (a domain module's and the
// API's event workers: the outbox publisher, a 'critical' job, and event retention, a 'standard' one), and that the default role keeps today's single-process deploy exactly as it was.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OutboxPublisher } from '../events/outbox-publisher';
import { EventRetentionWorker } from '../events/event-retention';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

function startsTimer(start: () => void): boolean {
  const spy = vi.spyOn(globalThis, 'setInterval');
  try { start(); return spy.mock.calls.length > 0; } finally { spy.mockRestore(); }
}

describe('background schedulers obey PROCESS_ROLE', () => {
  const outbox = () => new OutboxPublisher({} as any, { publish: async () => {} } as any);
  const retention = () => new EventRetentionWorker({} as any);   // a 'standard' job

  it("the default role ('all') starts them, exactly as before", () => {
    delete process.env.PROCESS_ROLE; process.env.EVENT_PUBLISHER_ENABLED = '1';
    const o = outbox(); expect(startsTimer(() => o.start())).toBe(true); o.stop();
    const r = retention(); expect(startsTimer(() => r.start())).toBe(true); r.stop();
  });
  it("the 'api' role starts none of them", () => {
    process.env.PROCESS_ROLE = 'api'; process.env.EVENT_PUBLISHER_ENABLED = '1';
    expect(startsTimer(() => outbox().start())).toBe(false);
    expect(startsTimer(() => retention().start())).toBe(false);
  });
  it("a worker starts only the classes it names", () => {
    process.env.PROCESS_ROLE = 'worker'; process.env.WORKER_JOB_CLASSES = 'ai'; process.env.EVENT_PUBLISHER_ENABLED = '1';
    expect(startsTimer(() => outbox().start())).toBe(false);            // critical — not this worker's
    process.env.WORKER_JOB_CLASSES = 'critical';
    const o = outbox(); expect(startsTimer(() => o.start())).toBe(true); o.stop();
  });

  // mandate §212 (Oct 20 2026): a database restore must not replay the outbox or re-run schedulers
  it('POST_RESTORE_HOLD=1: the outbox publisher dispatches nothing; cleared → it works again', async () => {
    const { runTick } = await import('@aipowersalon/observability');
    let published = 0;
    const o = new OutboxPublisher({ selectFrom: () => { throw new Error('db must not be touched while held'); } } as any, { publish: async () => { published++; } } as any);
    process.env.POST_RESTORE_HOLD = '1';
    try {
      expect(await o.tick()).toEqual({ claimed: 0, published: 0, failed: 0, reclaimed: 0 });
      expect(published).toBe(0);
      let ran = 0;
      expect(await runTick({ jobType: 'test.held', jobClass: 'standard', everyMs: 1000 } as any, async () => { ran++; })).toEqual({ ran: false });
      expect(ran).toBe(0);
    } finally { delete process.env.POST_RESTORE_HOLD; }
    let ran = 0;
    expect(await runTick({ jobType: 'test.held', jobClass: 'standard', everyMs: 1000 } as any, async () => { ran++; })).toEqual({ ran: true });
    expect(ran).toBe(1);
  });
});
