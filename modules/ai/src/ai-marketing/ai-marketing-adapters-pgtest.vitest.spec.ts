// _adapters.pgtest.ts — integration test of the REAL Kysely send adapters against PGlite (Postgres 15).
// Verifies the DB glue that unit tests (with in-memory fakes) can't: the recipient-enumeration SQL, the ledger
// idempotency claim, the attribution count, and tenant isolation. Run explicitly:
//   npx vitest run src/ai-marketing/_adapters.pgtest.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyPlanStore, KyselyRecipientSource, KyselySendLedger } from './ai-marketing-send.adapters';
import { KyselyCampaignConversions } from './ai-marketing-conversions';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(compiled: any) { const r = await pg.query(compiled.sql, compiled.parameters as any[]); return { rows: r.rows as any[] }; },
      async *streamQuery() {},
    };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

let db: Kysely<any>;
let pg: PGlite;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const CAMP_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const cust = (id: string, tenant: string, over: Record<string, any> = {}) => ({
  id, tenant_id: tenant, branch_id: null, status: 'active', archived_at: null,
  marketing_sms_opt_in: true, normalized_phone: '+16095551212', email: 'x@y.com',
  marketing_email_opt_in: true, birthday: null, ...over,
});

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;').catch(() => {});
  // minimal base schema the recipient query + attribution touch
  await pg.exec(`
    create table customers (id uuid primary key, tenant_id uuid not null, branch_id uuid,
      status text, archived_at timestamptz, marketing_sms_opt_in boolean, marketing_email_opt_in boolean,
      normalized_phone text, email text, birthday date);
    create table pos_tech_appointments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      customer_id uuid not null, status text, appt_date date);
    create table notification_opt_outs (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      channel text not null, address text not null, reason text, created_at timestamptz default now());
    create table ai_booking_conversion_events (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      branch_id uuid, source text, stage text, outcome text, failure_reason text, appointment_id text,
      actor_user_id text, correlation_id text, latency_ms integer, created_at timestamptz default now());`);
  // apply the REAL migrations under test
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/320_ai_marketing_campaign_sends.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/321_ai_marketing_campaign_plans.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/322_ai_booking_conversion_campaign_id.sql`, 'utf8'));

  // seed customers
  const rows = [
    cust('a0000000-0000-0000-0000-0000000000a1', A),                                   // A1 eligible
    cust('a0000000-0000-0000-0000-0000000000a2', A, { marketing_sms_opt_in: false }),  // A2 no consent
    cust('a0000000-0000-0000-0000-0000000000a3', A, { normalized_phone: null }),       // A3 no contact
    cust('a0000000-0000-0000-0000-0000000000a4', A),                                   // A4 future appt
    cust('a0000000-0000-0000-0000-0000000000a5', A),                                   // A5 too-recent visit
    cust('a0000000-0000-0000-0000-0000000000a6', A, { normalized_phone: '+16095559999' }), // A6 eligible (2nd, distinct #)
    cust('b0000000-0000-0000-0000-0000000000b1', B),                                   // B1 eligible (other tenant)
  ];
  for (const r of rows) {
    await pg.query(`insert into customers (id,tenant_id,branch_id,status,archived_at,marketing_sms_opt_in,marketing_email_opt_in,normalized_phone,email,birthday)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [r.id, r.tenant_id, r.branch_id, r.status, r.archived_at, r.marketing_sms_opt_in, r.marketing_email_opt_in, r.normalized_phone, r.email, r.birthday]);
  }
  // completed visit >90d ago → A1, A4, A5(recent), B1
  const appt = async (tenant: string, cid: string, status: string, daysAgo: number) =>
    pg.query(`insert into pos_tech_appointments (tenant_id, customer_id, status, appt_date) values ($1,$2,$3, (current_date - $4::int))`, [tenant, cid, status, daysAgo]);
  await appt(A, 'a0000000-0000-0000-0000-0000000000a1', 'completed', 120);
  await appt(A, 'a0000000-0000-0000-0000-0000000000a6', 'completed', 150);
  await appt(A, 'a0000000-0000-0000-0000-0000000000a4', 'completed', 120);
  await appt(A, 'a0000000-0000-0000-0000-0000000000a4', 'booked', -3);     // future appt → excluded
  await appt(A, 'a0000000-0000-0000-0000-0000000000a5', 'completed', 30);  // too recent → excluded
  await appt(B, 'b0000000-0000-0000-0000-0000000000b1', 'completed', 120);

  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
});

describe('KyselyRecipientSource (real SQL, PGlite)', () => {
  it('enumerates only eligible tenant-A recipients and never crosses tenants', async () => {
    const plans = new KyselyPlanStore(db);
    await plans.save({ campaignId: CAMP_A, tenantId: A, branchId: null, channel: 'sms', messageVersion: 1, body: 'hi', offerName: null,
      audienceDefinition: { minDaysSinceLastCompletedVisit: 90, excludeWithFutureAppointment: true, requireActiveStatus: true } as any }, null);
    const src = new KyselyRecipientSource(db, plans);
    const rows = await src.enumerate({ tenantId: A, branchId: '', userId: 'system', role: 'system', permissions: [] } as any, { id: CAMP_A } as any);
    const ids = rows.map((r) => r.customerId).sort();
    expect(ids).toEqual(['a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a6']); // A1 + A6 eligible
    expect(rows.every((r) => r.channel === 'sms' && r.address)).toBe(true);
  });
});

describe('KyselySendLedger idempotency (real UNIQUE index)', () => {
  it('claims once, then reports the existing row on a duplicate', async () => {
    const led = new KyselySendLedger(db);
    const parts = { tenantId: A, branchId: null, campaignId: CAMP_A, customerId: 'a0000000-0000-0000-0000-0000000000a1', channel: 'sms' as const, messageVersion: 1 };
    const key = [A, CAMP_A, parts.customerId, 'sms', '1'].join('|');
    const first = await led.claim(key, parts);
    const second = await led.claim(key, parts);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false); // UNIQUE index prevented a second send row
    await led.markSent(key, 'prov_123');
  });
});

describe('KyselyCampaignConversions (attribution, real SQL)', () => {
  it('counts BOOKING_SUCCEEDED events attributed to the campaign, tenant-scoped', async () => {
    await pg.query(`insert into ai_booking_conversion_events (tenant_id, source, stage, outcome, campaign_id) values ($1,'ONLINE_BOOKING','BOOKING_SUCCEEDED','succeeded',$2),($1,'ONLINE_BOOKING','BOOKING_SUCCEEDED','succeeded',$2)`, [A, CAMP_A]);
    await pg.query(`insert into ai_booking_conversion_events (tenant_id, source, stage, outcome, campaign_id) values ($1,'ONLINE_BOOKING','BOOKING_SUCCEEDED','succeeded',$2)`, [B, CAMP_A]); // other tenant
    const conv = new KyselyCampaignConversions(db);
    expect(await conv.bookedByCampaign(A, CAMP_A)).toBe(2);
    expect(await conv.bookedByCampaign(B, CAMP_A)).toBe(1);
  });
});


// End-to-end send executor over the REAL Kysely adapters + PGlite — runbook §7 smoke logic (opt-out-after-
// approval skipped, idempotent re-run, no cross-tenant dispatch) through the actual executeCampaign. Only the
// provider is mocked (a real send is notifications.service's separately-tested job). Uses its OWN campaign id
// so it is isolated from the ledger/conversions tests above.
import { AiMarketingSendService } from './ai-marketing-send.service';
import { StaticQuietHours } from './ai-marketing-send.adapters';

const CAMP_E = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

describe('AiMarketingSendService.executeCampaign (real adapters + PGlite — runbook §7 smoke)', () => {
  it('sends to eligible, skips a post-approval opt-out, is idempotent on re-run, and never crosses tenants', async () => {
    await pg.query(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+16095551212')`, [A]); // opt A1 out post-approval

    const plans = new KyselyPlanStore(db);
    await plans.save({ campaignId: CAMP_E, tenantId: A, branchId: null, channel: 'sms', messageVersion: 1, body: 'Hi', offerName: null,
      audienceDefinition: { minDaysSinceLastCompletedVisit: 90, excludeWithFutureAppointment: true, requireActiveStatus: true } as any }, null);

    const status: Record<string, string> = { [CAMP_E]: 'scheduled' };
    const lifecycle = {
      async detail(_ctx: any, id: string) { return { id, status: status[id], channel: 'sms', audienceSize: 0, name: 'c', tenantId: A } as any; },
      async transition(_ctx: any, id: string, to: string) { status[id] = to; return { id, status: to } as any; },
    };
    const dispatched: string[] = [];
    const dispatcher = { async send(_ctx: any, m: any) { dispatched.push(m.to); return { sent: true, status: 'sent', providerId: 'p' }; } };
    const limits = { async evaluate() { return { action: 'allow' as const }; } };
    const suppression = { async isOptedOut(t: string, c: string, a: string) {
      const r: any = await pg.query(`select 1 from notification_opt_outs where tenant_id=$1 and channel=$2 and address=$3 limit 1`, [t, c, a]);
      return r.rows.length > 0;
    } };
    const svc = new AiMarketingSendService(lifecycle as any, new KyselyRecipientSource(db, plans), new KyselySendLedger(db), limits as any, suppression as any, new StaticQuietHours() as any, dispatcher as any);
    const ctx = { tenantId: A, branchId: '', userId: 'system', role: 'system', permissions: [] } as any;

    // RUN 1 — A6 sent, A1 suppressed (opted out after approval)
    await svc.executeCampaign(ctx, { campaignId: CAMP_E, messageVersion: 1, body: 'Hi' });
    expect(dispatched.sort()).toEqual(['+16095559999']); // only A6
    expect(status[CAMP_E]).toBe('completed');
    const q = async (sql: string) => (await pg.query(sql, [A, CAMP_E])).rows as any[];
    const rows = await q(`select status, count(*)::int n from ai_marketing_campaign_sends where tenant_id=$1 and campaign_id=$2 group by status`);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(byStatus.sent).toBe(1);     // A6
    expect(byStatus.skipped).toBe(1);  // A1 opted out

    // RUN 2 — idempotent, no re-dispatch
    dispatched.length = 0; status[CAMP_E] = 'scheduled';
    await svc.executeCampaign(ctx, { campaignId: CAMP_E, messageVersion: 1, body: 'Hi' });
    expect(dispatched).toEqual([]);

    // tenant B never touched by this campaign
    const b: any = await pg.query(`select count(*)::int n from ai_marketing_campaign_sends where tenant_id=$1 and campaign_id=$2`, [B, CAMP_E]);
    expect(b.rows[0].n).toBe(0);
  });
});
