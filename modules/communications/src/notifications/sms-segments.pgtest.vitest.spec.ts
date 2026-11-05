// sms-segments.pgtest — Payments/Twilio mandate §77 / §87 (wave 3), on the real schema: the SMS ledger keeps the
// provider's SEGMENT count (the billable unit) and its own status / error code; the month's usage is summed in segments,
// with never-sized rows reported as unknown — not guessed as one.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { MockEmailSender } from '@aipowersalon/notifications';
import { NotificationsService } from './notifications.service';
import { KyselyNotificationsRepository } from './notifications.kysely.repository';
import { SmsTenantPlanService } from '../sms-packages/sms-tenant-plan.service';

const T = '22222222-1111-4111-8111-111111111111';
let db: any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) VALUES ($1, 'Seg Salon LLC', 'Seg Salon', 'seg-salon', 'SEG001', 'active') ON CONFLICT DO NOTHING`, [T]);
});
beforeEach(async () => { await sql`DELETE FROM notifications`.execute(db); });

describe('SMS segment accounting', () => {
  it('the send records the provider\'s segment count; the status callback adds the provider status, error code and a corrected count', async () => {
    const twoSegments = { async send() { return { sid: 'SMseg1', segments: 2 }; } } as any;
    const svc = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), twoSegments, new MockEmailSender());
    expect((await svc.sendSms({ tenantId: T, to: '+18565550100', body: 'a'.repeat(200), purpose: 'receipt' })).sent).toBe(true);
    let row = (await sql`SELECT segment_count, status, provider_status, provider_error_code FROM notifications WHERE provider_id = 'SMseg1'`.execute(db)).rows[0] as any;
    expect(row).toMatchObject({ segment_count: 2, status: 'sent', provider_status: null, provider_error_code: null });
    await svc.recordDeliveryStatus('SMseg1', 'undelivered', { errorCode: '30007', segments: 3 });
    row = (await sql`SELECT segment_count, status, provider_status, provider_error_code FROM notifications WHERE provider_id = 'SMseg1'`.execute(db)).rows[0] as any;
    expect(row).toMatchObject({ segment_count: 3, status: 'failed', provider_status: 'undelivered', provider_error_code: '30007' });
  });
  it('the month\'s usage is summed in SEGMENTS; a row the provider never sized is "unknown", never counted as 1', async () => {
    const sized = { async send() { return { sid: 'SM' + Math.random().toString(36).slice(2), segments: 3 }; } } as any;
    const unsized = { async send() { return { sid: 'SM' + Math.random().toString(36).slice(2) }; } } as any;
    await new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), sized, new MockEmailSender()).sendSms({ tenantId: T, to: '+18565550100', body: 'x', purpose: 'receipt' });
    await new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), sized, new MockEmailSender()).sendSms({ tenantId: T, to: '+18565550100', body: 'y', purpose: 'reminder' });
    await new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), unsized, new MockEmailSender()).sendSms({ tenantId: T, to: '+18565550100', body: 'z', purpose: 'reminder' });
    const u = await new SmsTenantPlanService(db, {} as any).messagingUsageThisMonth(T);
    expect(u).toMatchObject({ messages: 3, segments: 6, unknownSegments: 1 });
    const other = await new SmsTenantPlanService(db, {} as any).messagingUsageThisMonth('33333333-1111-4111-8111-111111111111');
    expect(other).toMatchObject({ messages: 0, segments: 0 });   // another salon's usage is never in this salon's view
  });
});
