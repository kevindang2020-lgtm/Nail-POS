// tech-queue-throughput.pgtest — TECH QUEUE extras #11: queue throughput with explicit numerator / denominator, the
// salon (branch time zone) business date, and a no-data state, against the real migrated schema.
//   salon day = America/New_York; 11:30 PM the day before (04:30 UTC today) is NOT today; another salon never counts.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyTechQueueRepository } from './tech-queue.kysely.repository';
import { buildTechQueueThroughput } from './tech-queue.dto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const P = 'c7e11000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), EMPTY_B = id('b3');
// fixed clock: 2026-11-12 13:00 in New York (18:00 UTC)
const NOW = Date.UTC(2026, 10, 12, 18, 0, 0);
let repo: KyselyTechQueueRepository; let pg: any;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  repo = new KyselyTechQueueRepository(kyselyFor(pg) as never); repo.now = () => NOW;
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Thru LLC','Thru Nails','tq-thru','TQT001','active'), ($2,'Other LLC','Other','tq-other','TQT002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Empty','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, EMPTY_B, B2, T2]);
  const CU = id('e1'), CU2 = id('e2');
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Cleo','X','Cleo X'), ($4,$5,$6,'Oli','X','Oli X')`, [CU, T, B, CU2, T2, B2]);
  let n = 0;
  const guest = (tenant: string, branch: string, at: string) => q(`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, status, checked_in_at) values ($1,$2,$3,'Guest','waiting',$4::timestamptz)`, [id('c' + String(++n).padStart(3, '0')), tenant, branch, at]);
  await guest(T, B, '2026-11-12T14:00:00Z'); await guest(T, B, '2026-11-12T15:00:00Z'); await guest(T, B, '2026-11-12T16:00:00Z'); await guest(T, B, '2026-11-12T17:00:00Z');
  await guest(T, B, '2026-11-12T04:30:00Z');        // 11:30 PM Nov 11 in New York — yesterday
  await guest(T2, B2, '2026-11-12T15:00:00Z');      // another salon
  const tk = (tenant: string, branch: string, started: string | null, done: string) => q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, serving_started_at, service_done_at)
    values ($1,$2,$3,$4,'closed',4000,$5,$6::timestamptz,$7::timestamptz)`, [id('d' + String(++n).padStart(3, '0')), tenant, branch, tenant === T ? CU : CU2, String(60000 + n), started, done]);
  await tk(T, B, '2026-11-12T14:20:00Z', '2026-11-12T15:00:00Z');   // 40 min
  await tk(T, B, '2026-11-12T15:10:00Z', '2026-11-12T16:00:00Z');   // 50 min
  await tk(T, B, null, '2026-11-12T16:30:00Z');                     // done, no start time → counted, not timed
  await tk(T, B, '2026-11-12T03:00:00Z', '2026-11-12T04:00:00Z');   // 11 PM Nov 11 New York — yesterday
  await tk(T2, B2, '2026-11-12T14:00:00Z', '2026-11-12T15:00:00Z'); // another salon
}, 240_000);

describe('Tech Queue throughput (salon day, numerator / denominator)', () => {
  it('counts today’s checked-in guests and completed services in the branch’s day, with the rate built from them', async () => {
    const t = await repo.throughput({ tenantId: T, branchId: B } as never);
    expect(t).toEqual({ businessDate: '2026-11-12', timeZone: 'America/New_York', checkedInGuests: 4, completedServices: 3, servedRatePercent: 75,
      serviceMinutes: 90, timedServices: 2, avgTurnMinutes: 45 });
  });

  it('a branch with nothing today is a no-data state: zero counts and null rates, never 0 %', async () => {
    const t = await repo.throughput({ tenantId: T, branchId: EMPTY_B } as never);
    expect(t.checkedInGuests).toBe(0); expect(t.completedServices).toBe(0);
    expect(t.servedRatePercent).toBeNull(); expect(t.avgTurnMinutes).toBeNull(); expect(t.businessDate).toBe('2026-11-12');
  });

  it('the pure builder never divides by zero and drops junk inputs', () => {
    expect(buildTechQueueThroughput({ businessDate: '2026-11-12', timeZone: 'UTC' }, { checkedInGuests: 0, completedServices: 2, serviceMinutes: Number.NaN, timedServices: 0 }))
      .toMatchObject({ servedRatePercent: null, serviceMinutes: 0, avgTurnMinutes: null, completedServices: 2 });
    expect(buildTechQueueThroughput({ businessDate: 'd', timeZone: 'UTC' }, { checkedInGuests: 3, completedServices: 1, serviceMinutes: 31, timedServices: 1 }).servedRatePercent).toBe(33.3);
  });
});
