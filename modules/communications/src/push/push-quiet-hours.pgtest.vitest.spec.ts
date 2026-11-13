// push-quiet-hours.pgtest — extras Customer Notifications 08 (round 10) on the REAL schema (migration 921): the push
// repository reads one person's quiet hours at one salon with the salon's time zone; the database refuses half a window.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyPushRepository } from './push.kysely.repository';

const id = (n: number) => `92100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), T2 = id(2), U = id(3);
let pg: any; let repo: KyselyPushRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite(); repo = new KyselyPushRepository(kyselyFor(pg) as never);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Q','Quiet','pq-921','PQ921','active'), ($2,'R','Other','pq-921b','PQ921B','active')`, [T, T2]);
  await q(`insert into branches (tenant_id, name, status, timezone) values ($1,'Main','active','America/Chicago')`, [T]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Q','oq@pq.test','active','OWNER')`, [U, T]);
}, 120_000);

describe('quiet hours on the real schema', () => {
  it('none set → null; set → the times and the salon zone; another salon\'s row is not this one', async () => {
    expect(await repo.quietHoursFor(T, U)).toBeNull();
    await q(`insert into user_notification_prefs (tenant_id, user_id, quiet_start, quiet_end) values ($1,$2,'22:00','07:00')`, [T, U]);
    expect(await repo.quietHoursFor(T, U)).toEqual({ start: '22:00', end: '07:00', timeZone: expect.any(String) });
    expect(await repo.quietHoursFor(T2, U)).toBeNull();
  });
  it('the database refuses half a window or a bad time', async () => {
    await expect(q(`update user_notification_prefs set quiet_end = null where user_id = $1`, [U])).rejects.toThrow(/quiet_chk/);
    await expect(q(`update user_notification_prefs set quiet_start = '24:00' where user_id = $1`, [U])).rejects.toThrow(/quiet_chk/);
  });
});
