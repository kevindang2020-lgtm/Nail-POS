// communications-activity.pgtest.vitest.spec.ts — the activity metrics against the REAL table shapes (migrations
// 114 communication_messages, 241 campaign_delivery_rollups, 299 voice_call_outcomes, 343 review_requests).
// Verifies tenant isolation on every metric and the zero-vs-unavailable distinction on real rows.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { CommunicationsActivityService } from './communications-activity.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any; }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'cb000000-0000-0000-0000-000000000001';   // the tenant under test
const OTHER = 'cb000000-0000-0000-0000-000000000002'; // a noisy neighbour — must never leak in
const QUIET = 'cb000000-0000-0000-0000-000000000003'; // a tenant with no activity at all
const TH1 = 'cb000000-0000-0000-0000-0000000000a1';
const TH2 = 'cb000000-0000-0000-0000-0000000000a2';
let svc: CommunicationsActivityService;

beforeAll(async () => {
  const pg = await PGlite.create();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* */ }
  await pg.exec(`CREATE TABLE communication_messages (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
    thread_id uuid not null, direction text not null, channel text not null default 'sms', body text not null,
    status text not null default 'sent', created_at timestamptz not null default now())`);
  await pg.exec(`CREATE TABLE campaign_delivery_rollups (id uuid primary key default gen_random_uuid(), subject_type text not null,
    subject_id text not null, tenant_id uuid, attempted integer not null default 0, delivered integer not null default 0,
    opted_out integer not null default 0)`);
  await pg.exec(`CREATE TABLE voice_call_outcomes (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
    branch_id uuid, provider text default 'retell', provider_call_id text, started_at timestamptz, created_at timestamptz not null default now())`);
  await pg.exec(`CREATE TABLE review_requests (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
    channel text not null default 'sms', status text not null default 'scheduled', idempotency_key text, created_at timestamptz not null default now())`);

  // Messages: TH1 answered in 10 min, TH2 answered in 20 min (avg 15). Two outbound TODAY. Other tenant is noisy.
  // HOUR-PROOF SEEDING (fixed Jul 29, 2026): the original rows sat at now()-110/160min and were counted against
  // the service's UTC-midnight "today" boundary — green all day, red the moment the clock crossed midnight (found
  // by the full battery at ~01:50 UTC). Response-time pairs now live UNAMBIGUOUSLY YESTERDAY (>24h ago — relative
  // gaps are all that metric reads), and "today's" outbounds are seeded at 00:00:05 UTC of the CURRENT day in a
  // thread with no inbound, so they count for messagesSentToday without touching the response average.
  const todayEarly = new Date(); todayEarly.setUTCHours(0, 0, 5, 0);
  await pg.query(`INSERT INTO communication_messages (tenant_id, thread_id, direction, body, created_at) VALUES
    ($1,$3,'inbound','hi',   now() - interval '26 hours'),
    ($1,$3,'outbound','hey', now() - interval '25 hours 50 minutes'),
    ($1,$4,'inbound','yo',   now() - interval '27 hours'),
    ($1,$4,'outbound','hi!', now() - interval '26 hours 40 minutes'),
    ($1,$5,'outbound','today a', $6::timestamptz),
    ($1,$5,'outbound','today b', $6::timestamptz),
    ($2,$3,'outbound','other tenant', now())`, [T, OTHER, TH1, TH2, '55555555-5555-4555-8555-555555555555', todayEarly.toISOString()]);
  await pg.query(`INSERT INTO campaign_delivery_rollups (subject_type, subject_id, tenant_id, attempted, delivered) VALUES
    ('tenant_campaign','c1',$1,100,95),
    ('tenant_campaign','c2',$1,100,90),
    ('tenant_campaign','c9',$2,10,1),
    ('platform_announcement','p1',$1,999,0)`, [T, OTHER]);
  await pg.query(`INSERT INTO voice_call_outcomes (tenant_id, provider_call_id, started_at) VALUES
    ($1,'call-1', now() - interval '2 days'),
    ($1,'call-2', now() - interval '5 days'),
    ($1,'call-old', now() - interval '90 days'),
    ($2,'call-other', now())`, [T, OTHER]);
  await pg.query(`INSERT INTO review_requests (tenant_id, status, idempotency_key) VALUES
    ($1,'sent','k1'),($1,'delivered','k2'),($1,'converted','k3'),($1,'scheduled','k4'),($1,'failed','k5'),($2,'sent','k6')`, [T, OTHER]);

  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new CommunicationsActivityService(db as any);
});

describe('communications activity on real tables', () => {
  it('reads every metric from its real source, tenant-scoped', async () => {
    const a = await svc.activity(T, 30);
    expect(a.messagesSentToday.value).toBe(2);                 // today's outbound, this tenant only
    expect(a.campaignDeliveryRatePct.value).toBe(93);          // (95+90)/200 — platform announcements excluded
    expect(a.aiCallsHandled.value).toBe(2);                    // 90-day-old call is outside the 30-day window
    expect(a.reviewRequestsSent.value).toBe(3);                // sent + delivered + converted; scheduled/failed excluded
    expect(a.avgResponseMinutes.value).toBe(15);               // (10 + 20) / 2
  });

  it('the other tenant sees only its own figures (no cross-tenant leak)', async () => {
    const a = await svc.activity(OTHER, 30);
    expect(a.campaignDeliveryRatePct.value).toBe(10);          // 1/10, not the 93 above
    expect(a.aiCallsHandled.value).toBe(1);
    expect(a.reviewRequestsSent.value).toBe(1);
  });

  it('a tenant with no activity gets honest zeros for COUNTS and unavailable for RATIOS', async () => {
    const a = await svc.activity(QUIET, 30);
    expect(a.messagesSentToday).toEqual({ value: 0, available: true });   // genuinely zero messages
    expect(a.aiCallsHandled.value).toBe(0);
    expect(a.campaignDeliveryRatePct.available).toBe(false);              // nothing attempted ≠ 0% delivered
    expect(a.avgResponseMinutes.available).toBe(false);                   // nothing answered ≠ 0 minutes
  });

  it('a narrower window excludes older calls', async () => {
    expect((await svc.activity(T, 3)).aiCallsHandled.value).toBe(1);
  });

  it('rebooking conversion stays unavailable even with a full database', async () => {
    expect((await svc.activity(T, 30)).rebookingConversionPct.available).toBe(false);
  });
});
