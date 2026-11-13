// push-staff-prefs.pgtest — extras round 11 on the REAL schema: the push dispatcher obeys the person's own notification
// switches (user_notification_prefs) through the ONE rule (api-contracts staffNotificationAllowed) and the ONE reader
// (notifications/staff-notification-prefs.ts). A held staff device is recorded 'suppressed' / staff_pref_off; a customer-app
// device, a security push, a person with no saved row and an unreadable row all still send.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyPushRepository } from './push.kysely.repository';
import { InMemoryPushRepository } from './push.repository';
import { PushService } from './push.service';
import { MockPushProvider } from './push-providers';
import type { PushMessage, PushProvider, PushTarget } from './push.types';

const id = (n: number) => `96100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), OWNER = id(2), TECH = id(3), NOROW = id(4), T2 = id(5);
let pg: any; let repo: KyselyPushRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
class Recording implements PushProvider { readonly name = 'mock'; sent: PushTarget[] = []; async send(t: PushTarget, _m: PushMessage) { this.sent.push(t); return { ok: true, providerId: 'p-' + t.token.slice(-4) }; } }
const svc = () => { const p = new Recording(); const s = new PushService(repo, p); return { s, p }; };
const logs = async (userId: string) => (await q(`select status, error_message, template from notification_delivery_logs where user_id = $1 order by created_at, id`, [userId])).rows as { status: string; error_message: string | null; template: string }[];
const setPrefs = (userId: string, cols: Record<string, boolean>, tenant = T) => {
  const names = Object.keys(cols); const vals = Object.values(cols);
  return q(`insert into user_notification_prefs (tenant_id, user_id, ${names.join(', ')}) values ($1, $2, ${names.map((_, i) => '$' + (i + 3)).join(', ')})
    on conflict (tenant_id, user_id) do update set ${names.map((n) => `${n} = excluded.${n}`).join(', ')}`, [tenant, userId, ...vals]);
};

beforeAll(async () => {
  pg = await migratedPglite(); repo = new KyselyPushRepository(kyselyFor(pg) as never);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Staff Prefs','sp-961','SP961','active'), ($2,'O','Other','sp-961b','SP961B','active')`, [T, T2]);
  await q(`insert into branches (tenant_id, name, status, timezone) values ($1,'Main','active','America/New_York')`, [T]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$4,'Owner','o@sp.test','active','OWNER'), ($2,$4,'Tech','t@sp.test','active','TECHNICIAN'), ($3,$4,'New','n@sp.test','active','MANAGER')`, [OWNER, TECH, NOROW, T]);
  await repo.upsertToken({ tenantId: T, userId: OWNER }, 'ios', 'owner-device-token-0001', 'owner');
  await repo.upsertToken({ tenantId: T, userId: TECH }, 'android', 'tech-device-token-0002', 'tech');
  await repo.upsertToken({ tenantId: T, userId: TECH }, 'android', 'cust-device-token-0003', 'customer');
  await repo.upsertToken({ tenantId: T, userId: NOROW }, 'ios', 'mgr-device-token-0004', 'manager');
}, 120_000);

describe('push dispatcher × staff notification switches (real schema)', () => {
  it('the reader: no row → default; a saved row → its switches; another salon\'s row is not this one', async () => {
    expect(await repo.staffPrefsFor(T, NOROW)).toEqual({ state: 'default', prefs: null });
    await setPrefs(OWNER, { booking_alerts: false }, T2);
    expect(await repo.staffPrefsFor(T, OWNER)).toEqual({ state: 'default', prefs: null });
    await setPrefs(OWNER, { booking_alerts: false });
    expect((await repo.staffPrefsFor(T, OWNER)).prefs).toMatchObject({ bookingAlerts: false, pushNotifications: true, smsNotifications: true });
  });

  it('Booking Alerts off: an owner booking push is HELD and recorded suppressed / staff_pref_off; a payment alert still sends', async () => {
    const { s, p } = svc();
    const held = await s.dispatchToUser(T, OWNER, { title: 'New appointment booked', category: 'BUSINESS_ALERT', data: { kind: 'appointment_created' }, reference: 'owner_booked:x' });
    expect(held).toMatchObject({ sent: 0, heldForStaffPref: 1 }); expect(p.sent).toHaveLength(0);
    expect((await logs(OWNER)).at(-1)).toEqual({ status: 'suppressed', error_message: 'staff_pref_off', template: 'owner_booked:x' });
    const pay = await s.dispatchToUser(T, OWNER, { title: 'Payment received', category: 'PAYMENT_ALERT', data: { kind: 'payment_received' }, reference: 'payment_received:x' });
    expect(pay).toMatchObject({ sent: 1 }); expect(pay.heldForStaffPref).toBeUndefined();
    expect((await logs(OWNER)).at(-1)).toMatchObject({ status: 'sent', template: 'payment_received:x' });
  });

  it('Push Notifications off: every staff push is held, but a SECURITY push always goes', async () => {
    await setPrefs(OWNER, { push_notifications: false, booking_alerts: true });
    const { s, p } = svc();
    expect(await s.dispatchToUser(T, OWNER, { title: 'Queue', category: 'QUEUE_CONGESTION', reference: 'queue_alert' })).toMatchObject({ sent: 0, heldForStaffPref: 1 });
    expect(await s.dispatchToUser(T, OWNER, { title: 'New sign-in', category: 'SECURITY', reference: 'security:new_device' })).toMatchObject({ sent: 1 });
    expect(p.sent.map((t) => t.token)).toEqual(['owner-device-token-0001']);
  });

  it('Payroll Approvals off: "payroll ready for review" is held; "payroll paid" (not an approval) still sends', async () => {
    await setPrefs(TECH, { payroll_approvals: false });
    const { s, p } = svc();
    expect(await s.dispatchToUser(T, TECH, { title: 'Payroll is ready for review', category: 'PAYROLL', data: { kind: 'payroll_ready_for_review' }, reference: 'payroll_ready_for_review' })).toMatchObject({ sent: 0, heldForStaffPref: 1 });
    expect(await s.dispatchToUser(T, TECH, { title: 'Payroll paid', category: 'PAYROLL', data: { kind: 'payroll_paid' }, reference: 'payroll_paid' })).toMatchObject({ sent: 1 });
    expect(p.sent.map((t) => t.token)).toEqual(['tech-device-token-0002']);
  });

  it('a held staff push never touches the same person\'s CUSTOMER-app device (it has its own consent)', async () => {
    await setPrefs(TECH, { booking_alerts: false });
    const { s, p } = svc();
    // APPOINTMENT_CONFIRMATION targets both the tech and the customer app
    const r = await s.dispatchToUser(T, TECH, { title: 'Booked', category: 'APPOINTMENT_CONFIRMATION', data: { kind: 'appointment_created' }, reference: 'customer_booked:y' });
    expect(r).toMatchObject({ tokens: 2, sent: 1, heldForStaffPref: 1 });
    expect(p.sent.map((t) => t.token)).toEqual(['cust-device-token-0003']);
  });

  it('no saved row → defaults (all on): the manager\'s booking push sends', async () => {
    const { s } = svc();
    expect(await s.dispatchToUser(T, NOROW, { title: 'Booked', category: 'BUSINESS_ALERT', data: { kind: 'appointment_created' } })).toMatchObject({ sent: 1 });
  });

  it('an UNREADABLE preference never silences a push (sends; same as quiet hours)', async () => {
    const mem = new InMemoryPushRepository();
    mem.staffPrefsFor = async () => { throw new Error('connection reset'); };
    await mem.upsertToken({ tenantId: T, userId: OWNER }, 'ios', 'mem-owner-token-0009', 'owner');
    const r = await new PushService(mem, new MockPushProvider()).dispatchToUser(T, OWNER, { title: 'Booked', category: 'BUSINESS_ALERT', data: { kind: 'appointment_created' } });
    expect(r).toMatchObject({ sent: 1 }); expect(mem.logs.map((l) => l.status)).toEqual(['sent']);
  });
});
