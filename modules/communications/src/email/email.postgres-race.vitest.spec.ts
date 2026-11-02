// email.postgres-race — the Email Center's concurrency claims on REAL Postgres with real sessions (Email guide §09, 4.3, §12):
//   • 8 workers send the same booking confirmation (same idempotency key) at once → ONE provider call, ONE ledger row
//   • the provider delivers the same signed event batch 6 times at once → ONE event row per status, the row moves once
//   • two staff resend the same failed email at once (different request ids) → ONE new attempt; the other is refused
// Fresh random tenant per run (the CI race database is shared); the ledgers are append-only, so rows stay.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { MockEmailSender, MockSmsSender } from '@aipowersalon/notifications';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';
import { CustomerNotificationsCenter, type CnSender } from '../notifications/customer-notifications';
import { KyselyEmailPolicy } from './email-policy';
import { applyEmailEvents } from './email-events';

const url = process.env.PG_RACE_URL;
const TAG = `emr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), C = randomUUID(), OWNER = randomUUID();
const ENV: NodeJS.ProcessEnv = { NODE_ENV: 'test', SENDGRID_FROM: 'mail@salon.example' };

describe.skipIf(!url)('Email on real Postgres: one send per key, one event per status, one resend', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const mail = new MockEmailSender();
  // one NotificationsService per session — they share only the database (and the provider, which counts calls)
  const svcs = dbs.map((d) => new NotificationsService(new KyselyNotificationsRepository(d), new MockSmsSender() as any, mail as any, undefined, new KyselyOptOutRepository(d), undefined, undefined, new KyselyEmailPolicy(d, ENV)));
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${'Race Salon'}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', ${TAG + '@race.test'}, 'active', 'OWNER')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values (${C}, ${T}, ${B}, 'Ava', 'Race', 'Ava Race', '+16095550199', ${TAG + '-c@race.test'}, 'active')`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('8 workers, one booking confirmation key → ONE provider call and ONE ledger row; every worker gets the same attempt', async () => {
    const appt = randomUUID(); const n0 = mail.sent.length;
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => svcs[i % 4].sendEmail({ tenantId: T, branchId: B, customerId: C, to: `${TAG}-c@race.test`, subject: 'Your appointment', body: 'Confirmed',
      purpose: 'notification', category: 'booking_confirmation', source: { type: 'appointment', id: appt }, idempotencyKey: `booking_confirmation:${appt}` })));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect(mail.sent.length - n0).toBe(1);
    expect(Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T} and source_id = ${appt}`))[0].n)).toBe(1);
    const firsts = out.map((o: any) => o.value).filter((v) => !v.duplicate); expect(firsts.length).toBe(1);
  });

  it('the same signed event batch delivered 6 times at once → one event row per status; the row moves to delivered exactly once', async () => {
    const r = await svcs[0].sendEmail({ tenantId: T, to: `${TAG}-c@race.test`, subject: 'S', body: 'B', purpose: 'notification' });
    const sid = `SG${TAG}`;
    await q(sql`update notifications set status = 'sent', provider_id = ${sid} where id = ${r.notificationId}`);
    const batch = [{ sg_message_id: `${sid}.x`, event: 'processed' }, { sg_message_id: `${sid}.x`, event: 'delivered', timestamp: Math.floor(Date.now() / 1000) }];
    const res = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => applyEmailEvents(dbs[i % 4], batch)));
    expect(res.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const sum = res.map((o: any) => o.value).reduce((a: any, v: any) => ({ applied: a.applied + v.applied, duplicates: a.duplicates + v.duplicates }), { applied: 0, duplicates: 0 });
    expect(sum.applied).toBe(1); expect(sum.duplicates).toBe(12 - 2);
    expect((await q(sql`select provider_status from notification_delivery_events where tenant_id = ${T} and notification_id = ${r.notificationId} order by provider_status`)).map((x: any) => x.provider_status)).toEqual(['delivered', 'processed']);
    expect((await q(sql`select status from notifications where id = ${r.notificationId}`))[0].status).toBe('delivered');
  });

  it('two staff resend the same failed email at once → ONE new attempt; the other is refused (already resent)', async () => {
    const f = (await q(sql`insert into notifications (tenant_id, channel, to_address, subject, body, customer_id, status, failure_reason, purpose, branch_id)
        values (${T}, 'email', ${TAG + '-c@race.test'}, 'Your receipt', 'Total', ${C}, 'failed', 'email_failed:503', 'receipt', ${B}) returning id`))[0].id;
    const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.communications.view', 'pos.communications.manage'] };
    const centers = dbs.map((d, i) => new CustomerNotificationsCenter(d, svcs[i] as unknown as CnSender, null, ENV, () => Date.now()));
    const out = await Promise.allSettled([centers[0].retry(ctx as any, f, { idempotencyKey: `${TAG}-rs-a`, confirm: true }), centers[1].retry(ctx as any, f, { idempotencyKey: `${TAG}-rs-b`, confirm: true })]);
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const v = out.map((o: any) => o.value);
    expect(v.filter((x) => x.outcome === 'simulated' || x.outcome === 'sent').length).toBe(1);
    expect(v.filter((x) => x.outcome === 'refused' && x.refusalCode === 'NOTIFICATION_RETRY_ALREADY_RESENT').length).toBe(1);
    expect(Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T} and retry_of_notification_id = ${f}`))[0].n)).toBe(1);
    expect((await q(sql`select status from notifications where id = ${f}`))[0].status).toBe('failed');
  });
});
