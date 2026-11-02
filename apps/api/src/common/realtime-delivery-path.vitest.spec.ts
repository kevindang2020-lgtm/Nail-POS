// realtime-delivery-path — Constitution 8 / 13 §343. A service skips its direct realtime emission when its repository
// "emits domain events" — i.e. when the event will reach clients through the projection. That used to mean "has an
// outbox writer", which is ALWAYS true with a database, so with EVENT_PUBLISHER_ENABLED off the event sat in the outbox and
// no screen heard it. Every repository that answers the question must now also require the publisher to be ON.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KyselyCheckoutRepository } from '@aipowersalon/checkout';
import { KyselyBookingRepository } from '@aipowersalon/booking';
import { KyselyQueueRepository, KyselyServiceDoneRepository } from '@aipowersalon/queue';
import { KyselyCustomersRepository } from '@aipowersalon/customers';
import { KyselyTechApptRepository } from '@aipowersalon/appointments';
import { KyselyDailyFollowUpRepository } from '@aipowersalon/communications';
import { codeRoots } from '../../test-support/code-roots';
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' || n === 'dist' ? [] : walk(p)) : /\.ts$/.test(n) && !/\.(spec|test)\.ts$/.test(n) ? [p] : []; });

const saved = process.env.EVENT_PUBLISHER_ENABLED;
afterEach(() => { if (saved === undefined) delete process.env.EVENT_PUBLISHER_ENABLED; else process.env.EVENT_PUBLISHER_ENABLED = saved; });

const REPOS: [string, (db: any, outbox: any) => { emitsDomainEvents(): boolean }][] = [
  ['checkout', (d, o) => new KyselyCheckoutRepository(d, o)], ['booking', (d, o) => new KyselyBookingRepository(d, o)],
  ['queue', (d, o) => new KyselyQueueRepository(d, o)], ['service-done', (d, o) => new KyselyServiceDoneRepository(d, o)],
  ['customers', (d, o) => new KyselyCustomersRepository(d, o)], ['tech-appointments', (d, o) => new KyselyTechApptRepository(d, o)],
  ['follow-ups', (d, o) => new KyselyDailyFollowUpRepository(d, o)],
];

describe('the direct-vs-projection realtime decision', () => {
  it.each(REPOS)('%s: with an outbox but the publisher OFF, the service must emit directly', (_n, make) => {
    delete process.env.EVENT_PUBLISHER_ENABLED;
    expect(make({}, { record: async () => {} }).emitsDomainEvents()).toBe(false);
  });
  it.each(REPOS)('%s: with the publisher ON, the projection delivers (no double emission)', (_n, make) => {
    process.env.EVENT_PUBLISHER_ENABLED = '1';
    expect(make({}, { record: async () => {} }).emitsDomainEvents()).toBe(true);
  });
  it('every emitsDomainEvents implementation decides through projectionDeliversRealtime', () => {
    const bad: string[] = [];
    for (const root of codeRoots()) for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      // decides through the rule, or DELEGATES to a repository's emitsDomainEvents (which this same check covers) — the
      // tech-queue service asks its repository so the acceptance sweep can gate on the service
      for (const m of src.matchAll(/emitsDomainEvents\(\)\s*:\s*boolean\s*\{([^}]*)\}/g)) if (!/projectionDeliversRealtime\(|\.emitsDomainEvents\?\.\(\)/.test(m[1])) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
