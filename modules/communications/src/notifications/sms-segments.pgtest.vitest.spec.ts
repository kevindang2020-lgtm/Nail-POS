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

describe('SMS sender route (mandate §65, migration 678): every ledger row says which path carried it', () => {
  const A = T, B = '44444444-1111-4111-8111-111111111111';
  const shared = { from: [] as (string | undefined)[], async send(_to: string, _b: string, from?: string) { this.from.push(from); return { sid: 'SMsh' + Math.random().toString(36).slice(2) }; } } as any;
  const own = Object.assign({ async send() { return { sid: 'SMown' + Math.random().toString(36).slice(2) }; } }, { senderFrom: '+16095550111' });
  const tenantSender = { async resolveSender(t: string) { return t === A ? own : null; } };       // only salon A has its own account
  const numbers = { async resolveFrom(t: string) { return t === B ? '+16095550222' : null; } };   // salon B has a registered number
  const svc = () => new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), shared, new MockEmailSender(), undefined, undefined, numbers, tenantSender);
  const rowOf = async (t: string) => (await sql`SELECT sender_route, sender_from FROM notifications WHERE tenant_id = ${t}`.execute(db)).rows as any[];
  it('salon A → its own Twilio account and From; salon B → the platform account with B\'s number — never each other\'s', async () => {
    expect((await svc().sendSms({ tenantId: A, to: '+18565550100', body: 'a', purpose: 'receipt' })).sent).toBe(true);
    expect((await svc().sendSms({ tenantId: B, to: '+18565550101', body: 'b', purpose: 'receipt' })).sent).toBe(true);
    expect(await rowOf(A)).toEqual([{ sender_route: 'tenant_account', sender_from: '+16095550111' }]);
    expect(await rowOf(B)).toEqual([{ sender_route: 'shared_salon_number', sender_from: '+16095550222' }]);
    expect(shared.from).toEqual(['+16095550222']);                       // the shared account was used once — for B, From = B's number
  });
  it('no salon number → the platform default: a sender that does not report its From records NULL (never guessed); a failed send keeps its route', async () => {
    const C = '55555555-1111-4111-8111-111111111111';
    await svc().sendSms({ tenantId: C, to: '+18565550102', body: 'c', purpose: 'receipt' });
    expect(await rowOf(C)).toEqual([{ sender_route: 'shared_default', sender_from: null }]);
    const failing = Object.assign({ async send() { throw new Error('provider down'); } }, { senderFrom: '+16095550111' });
    const svcF = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), shared, new MockEmailSender(), undefined, undefined, numbers, { async resolveSender() { return failing; } });
    await sql`DELETE FROM notifications`.execute(db);
    expect((await svcF.sendSms({ tenantId: A, to: '+18565550100', body: 'a', purpose: 'receipt' })).sent).toBe(false);
    expect(await rowOf(A)).toEqual([{ sender_route: 'tenant_account', sender_from: '+16095550111' }]);
  });
  it('P2-2 (Oct 23 2026): the platform default sender REPORTS the From it used (TWILIO_FROM / Twilio\'s answer) → every shared_default row names it', async () => {
    const D = '66666666-1111-4111-8111-111111111111';
    const reporting = { async send(_to: string, _b: string, from?: string) { return { sid: 'SMdf' + Math.random().toString(36).slice(2), senderFrom: from || '+16095550999' }; } } as any;
    const svcD = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), reporting, new MockEmailSender(), undefined, undefined, numbers, tenantSender);
    expect((await svcD.sendSms({ tenantId: D, to: '+18565550103', body: 'd', purpose: 'receipt' })).sent).toBe(true);
    expect(await rowOf(D)).toEqual([{ sender_route: 'shared_default', sender_from: '+16095550999' }]);
  });
});

