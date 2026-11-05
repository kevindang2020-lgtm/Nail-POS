// communications-activity.pgtest.vitest.spec.ts — the activity metrics against the REAL table shapes (migrations
// 114 communication_messages, 241 campaign_delivery_rollups, 299 voice_call_outcomes, 343 review_requests).
// Verifies tenant isolation on every metric and the zero-vs-unavailable distinction on real rows.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { dayStartMs } from '@aipowersalon/date-time';
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
    status text not null default 'sent', author_kind text, created_at timestamptz not null default now())`);   // author_kind: migration 730
  await pg.exec(`CREATE TABLE campaign_delivery_rollups (id uuid primary key default gen_random_uuid(), subject_type text not null,
    subject_id text not null, tenant_id uuid, attempted integer not null default 0, delivered integer not null default 0,
    opted_out integer not null default 0)`);
  await pg.exec(`CREATE TABLE voice_call_outcomes (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
    branch_id uuid, provider text default 'retell', provider_call_id text, started_at timestamptz, created_at timestamptz not null default now())`);
  // C2 audit (Nov 4 2026): rebooking conversion reads the win-back recipients and the bookings made after the text
  await pg.exec(`CREATE TABLE retention_sms_recipients (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, campaign_id uuid, customer_id uuid not null, status text not null, sent_at timestamptz)`);
  await pg.exec(`CREATE TABLE retention_sms_campaigns (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid)`);
  await pg.exec(`CREATE TABLE communication_threads (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid)`);
  await pg.exec(`CREATE TABLE pos_tech_appointments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid, created_at timestamptz not null default now())`);
  await pg.exec(`CREATE TABLE tenant_retention_settings (tenant_id uuid primary key, observation_window_days integer not null default 30)`);
  await pg.query(`INSERT INTO retention_sms_recipients (tenant_id, customer_id, status, sent_at) VALUES
    ($1, 'cb000000-0000-0000-0000-0000000000c1', 'sent', now() - interval '10 days'),
    ($1, 'cb000000-0000-0000-0000-0000000000c2', 'sent', now() - interval '10 days'),
    ($1, 'cb000000-0000-0000-0000-0000000000c3', 'blocked', null),
    ($2, 'cb000000-0000-0000-0000-0000000000c9', 'sent', now() - interval '2 days')`, [T, OTHER]);
  await pg.query(`INSERT INTO pos_tech_appointments (tenant_id, customer_id, created_at) VALUES
    ($1, 'cb000000-0000-0000-0000-0000000000c1', now() - interval '7 days'),
    ($1, 'cb000000-0000-0000-0000-0000000000c2', now() - interval '40 days'),
    ($2, 'cb000000-0000-0000-0000-0000000000c9', now() - interval '1 days')`, [T, OTHER]);
  await pg.exec(`CREATE TABLE review_requests (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
    channel text not null default 'sms', status text not null default 'scheduled', idempotency_key text, created_at timestamptz not null default now())`);

  // Messages: TH1 answered in 10 min, TH2 answered in 20 min (avg 15). Two outbound TODAY. Other tenant is noisy.
  // HOUR-PROOF SEEDING (fixed Jul 29, 2026): the original rows sat at now()-110/160min and were counted against
  // the service's UTC-midnight "today" boundary — green all day, red the moment the clock crossed midnight (found
  // by the full battery at ~01:50 UTC). Response-time pairs now live UNAMBIGUOUSLY YESTERDAY (>24h ago — relative
  // gaps are all that metric reads), and "today's" outbounds are seeded at 00:00:05 UTC of the CURRENT day in a
  // thread with no inbound, so they count for messagesSentToday without touching the response average.
  // Communications guide (Oct 30 2026): "today" is now the SALON's day (America/New_York when no branch says otherwise),
  // so today's outbounds are seeded 5 s after LOCAL midnight — inside today whatever the UTC clock says.
  const todayEarly = new Date(dayStartMs('America/New_York') + 5000);
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

  it('C2 audit: a location filter counts only that location; salon-wide-only sources are unavailable, not salon-wide', async () => {
    const BR = 'cb000000-0000-0000-0000-0000000000b1';
    const a = await svc.activity(T, 30, [BR]);
    expect(a.branchIds).toEqual([BR]);
    expect(a.campaignDeliveryRatePct.available).toBe(false);
    expect(a.aiCallsHandled.value).toBe(0);           // every seeded call is salon-wide (no location)
    expect(a.messagesSentToday.value).toBe(0);        // no thread of that location
    expect(a.reviewRequestsSent).toEqual({ value: 0, available: true });
    expect((await svc.activity(T, 30)).aiCallsHandled.value).toBeGreaterThan(0);
  });

  it('rebooking conversion = win-back texted customers who booked after the text (within the observation window)', async () => {
    expect((await svc.activity(T, 30)).rebookingConversionPct).toEqual({ value: 50, available: true });   // c1 booked after; c2 booked BEFORE the text; c3 never left
    const quiet = (await svc.activity(QUIET, 30)).rebookingConversionPct;
    expect(quiet.available).toBe(false); expect(quiet.reason).toMatch(/No win-back texts/);
  });
});
