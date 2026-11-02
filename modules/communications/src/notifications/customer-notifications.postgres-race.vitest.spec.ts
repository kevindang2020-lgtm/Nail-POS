// customer-notifications.postgres-race — Customer Notifications Complete Build Guide §09 / §10 / §12 on REAL Postgres with REAL
// concurrency (four Kysely instances = four sessions):
//   • six staff press "Resend" on the same failed text at once (six different request ids) → ONE new text, five refusals
//   • the provider delivers the same "delivered" callback eight times at once → one evidence row, the ledger row delivered once
//   • four evaluator ticks race → ONE open incident per rule (the partial unique index on owner_alerts)
// Fresh random salon per run (the CI race database is shared); the ledger and evidence tables are append-only by design.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { MockEmailSender } from '@aipowersalon/notifications';
import { NotificationsService } from './notifications.service';
import { KyselyNotificationsRepository } from './notifications.kysely.repository';
import { KyselyOptOutRepository } from './notifications.optout.kysely.repository';
import { CustomerNotificationsCenter, evaluateMessagingIncidents, type CnContext, type CnSender } from './customer-notifications';

const url = process.env.PG_RACE_URL;
const TAG = `cnr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), U = randomUUID(), C = randomUUID();
const PHONE = '+1609' + String(Math.floor(1e6 + Math.random() * 8.9e6));

class FakeTwilio { n = 0; async send() { this.n++; return { sid: 'SM' + randomUUID().replace(/-/g, ''), segments: 1 }; } }

describe.skipIf(!url)('Customer Notifications on real Postgres: resend, callbacks, incidents', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const twilio = new FakeTwilio();
  const svcs = dbs.map((d) => new NotificationsService(new KyselyNotificationsRepository(d), twilio as any, new MockEmailSender() as any, undefined, new KyselyOptOutRepository(d), undefined, undefined));
  const centers = dbs.map((d, i) => new CustomerNotificationsCenter(d, svcs[i] as unknown as CnSender, null, {}, () => Date.now()));
  const owner: CnContext = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.communications.view', 'pos.communications.manage'] };
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${'Race ' + TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${U}, ${T}, 'Race Owner', ${TAG + '@race.test'}, 'active', 'OWNER')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${C}, ${T}, ${B}, 'Ana', 'Race', 'Ana Race', ${PHONE}, 'active')`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('six concurrent resends of one failed text (different request ids) → exactly ONE new text; the rest refused, nothing doubled', async () => {
    const orig = String((await q(sql`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, failure_reason, purpose, branch_id, created_at)
      values (${T}, 'sms', ${PHONE}, 'Your receipt', ${C}, 'failed', 'fetch failed: ETIMEDOUT', 'receipt', ${B}, now() - interval '10 minutes') returning id`))[0].id);
    const before = twilio.n;
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, k) => centers[k % 4].retry(owner, orig, { idempotencyKey: `${TAG}-resend-${k}`, confirm: true })));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const v = out.map((o: any) => o.value);
    expect(v.filter((x) => x.outcome === 'sent').length).toBe(1);
    expect(v.filter((x) => x.outcome === 'refused').map((x) => x.refusalCode)).toEqual(Array(5).fill('NOTIFICATION_RETRY_ALREADY_RESENT'));
    expect(twilio.n - before).toBe(1);
    expect(Number((await q(sql`select count(*)::int n from notifications where tenant_id = ${T} and retry_of_notification_id = ${orig}`))[0].n)).toBe(1);
    expect((await q(sql`select status from notifications where id = ${orig}`))[0].status).toBe('failed');
  });

  it('eight identical "delivered" callbacks at once → one evidence row, the ledger row delivered, no error', async () => {
    const r = await svcs[0].sendSms({ tenantId: T, branchId: B, to: PHONE, body: 'Your appointment', purpose: 'reminder', customerId: C });
    const sid = String(r.providerId);
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, k) => svcs[k % 4].recordDeliveryStatus(sid, 'delivered', {}, { tenantId: T })));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect((await q(sql`select status from notifications where id = ${r.notificationId}`))[0].status).toBe('delivered');
    expect((await q(sql`select provider_status, applied from notification_delivery_events where tenant_id = ${T} and provider_message_sid = ${sid}`)).map((e: any) => [e.provider_status, e.applied])).toEqual([['delivered', true]]);
  });

  it('four evaluator ticks race on three auth failures → ONE open incident for that rule', async () => {
    for (let i = 0; i < 3; i++) await q(sql`insert into notifications (tenant_id, channel, to_address, body, status, failure_reason, provider_error_code, created_at)
      values (${T}, 'sms', ${PHONE}, 'x', 'failed', 'sms_failed:Authentication failed', '20003', now() - make_interval(mins => ${i + 1}))`);
    const out = await Promise.allSettled(dbs.map((d) => evaluateMessagingIncidents(d, T, { readiness: null })));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const open = await q(sql`select metadata->>'dedupeKey' as k from owner_alerts where tenant_id = ${T} and category = 'messaging_failure' and status in ('new', 'acknowledged', 'in_progress')`);
    expect(open.filter((x: any) => x.k === 'repeated_failures:sms:auth').length).toBe(1);
  });
});
