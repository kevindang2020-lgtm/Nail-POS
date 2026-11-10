// notification-deliveries.pgtest — batch 8 decision 7 (Nov 9 2026) on the REAL schema: a user's OWN alert deliveries,
// newest first, filters, inclusive salon-local days, pages — and nobody else's rows.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ProfileService } from './profile.service';

const P = 'c8470000-0000-4000-8000-'; const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), X = id(2), U = id(3), U2 = id(4), B = id(5);
const ctx = { tenantId: T, userId: U, role: 'OWNER' };
let db: any; let svc: ProfileService;
const q = async (s: any) => (await s.execute(db)).rows;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  svc = new ProfileService(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'nd-847', 'ND847', 'active'), (${X}, 'X', 'Other', 'nd-847x', 'ND847X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
  await q(sql`insert into notification_delivery_logs (tenant_id, user_id, channel, target_masked, template, status, error_message, created_at) values
    (${T}, ${U}, 'sms', '***-***-0101', 'missed_call_alert', 'delivered', null, '2026-11-09T15:00:00Z'),
    (${T}, ${U}, 'email', 'o***@pilot.test', 'weekly_report', 'failed', 'mailbox full', '2026-11-08T04:30:00Z'),
    (${T}, ${U}, 'push', 'device …a1', 'booking_alert', 'sent', null, '2026-11-07T12:00:00Z'),
    (${T}, ${U2}, 'sms', '***-***-0202', 'missed_call_alert', 'delivered', null, '2026-11-09T15:00:00Z'),
    (${X}, ${U}, 'sms', '***-***-0303', 'missed_call_alert', 'delivered', null, '2026-11-09T15:00:00Z')`);
});

describe('my notification deliveries', () => {
  it('returns only my own rows in this salon, newest first', async () => {
    const r = await svc.notificationDeliveries(ctx, { page: 1 });
    expect(r.items.map((x) => x.template)).toEqual(['missed_call_alert', 'weekly_report', 'booking_alert']);
    expect(r).toMatchObject({ total: 3, page: 1, totalPages: 1 });
    expect(r.items[1]).toMatchObject({ channel: 'email', status: 'failed', error: 'mailbox full' });
  });
  it('filters by channel, status and search', async () => {
    expect((await svc.notificationDeliveries(ctx, { channel: 'push' })).items.map((x) => x.template)).toEqual(['booking_alert']);
    expect((await svc.notificationDeliveries(ctx, { status: 'failed' })).total).toBe(1);
    expect((await svc.notificationDeliveries(ctx, { q: 'weekly' })).items).toHaveLength(1);
  });
  it('From/To are the salon\'s own days (the 04:30Z email is Nov 7 in New York)', async () => {
    expect((await svc.notificationDeliveries(ctx, { from: '2026-11-07', to: '2026-11-07' })).items.map((x) => x.template)).toEqual(['weekly_report', 'booking_alert']);
    await expect(svc.notificationDeliveries(ctx, { from: '2026-11-09', to: '2026-11-01' })).rejects.toThrow(/start date/);
  });
  it('pages', async () => {
    const r = await svc.notificationDeliveries(ctx, { pageSize: 10, page: 5 });
    expect(r.page).toBe(1);
  });
});
