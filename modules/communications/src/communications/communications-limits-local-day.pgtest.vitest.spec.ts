// communications-limits-local-day.pgtest — a salon's messaging limits count ITS month and ITS day (Oct 6 2026), not the
// database's UTC ones. The clock is fixed at 9:30 pm Saturday Oct 31 in New York (01:30 UTC Sunday Nov 1): in UTC the month
// has already turned, so the old count started over at 8 pm and a salon could send a second month's allowance that night.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { CommunicationsLimitsRepository } from './communications-limits.kysely.repository';

const T = 'cfcfcfcf-0000-4000-8000-000000000001';
const B = 'cfcfcfcf-0000-4000-8000-000000000002';
const NOW = Date.parse('2026-11-01T01:30:00Z');
let repo: CommunicationsLimitsRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite(); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Limits Day LLC','Limits Day','limits-day','LIMD01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  const log = (channel: string, at: string) => q(`insert into notification_delivery_logs (tenant_id, channel, target_masked, template, status, created_at) values ($1,$2,'***1234','reminder','sent',$3)`, [T, channel, at]);
  await log('sms', '2026-10-01T03:00:00Z');     // 11 pm Wed Sep 30 here — last month (but October in UTC)
  await log('sms', '2026-10-15T16:00:00Z');     // Oct 15 — this month
  await log('email', '2026-10-31T03:00:00Z');   // 11 pm Fri Oct 30 — this month, yesterday
  await log('sms', '2026-10-31T14:00:00Z');     // 10 am today
  await log('email', '2026-11-01T01:00:00Z');   // 9 pm tonight — November in UTC, still Oct 31 here
  repo = new CommunicationsLimitsRepository(kyselyFor(pg) as never); repo.now = () => NOW;
});

describe('the salon\'s month and day', () => {
  it('month to date: the four October messages — not 1 (UTC November), not 5 (from UTC Oct 1, which is Sep 30 here)', async () => {
    expect(await repo.monthUsage(T)).toEqual({ sms: 2, email: 2, push: 0, total: 4 });
  });
  it('today: 10 am and 9 pm — not 1 (UTC Sunday), not 3 (last night too)', async () => {
    expect(await repo.todayUsage(T)).toBe(2);
  });
});
