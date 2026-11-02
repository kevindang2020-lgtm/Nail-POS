import { describe, it, expect, beforeEach } from 'vitest';
import { MembershipCommsService, ValidationError } from './membership-comms.service';
import { InMemoryMembershipCommsRepository, type CommsContext } from './membership-comms.repository';

const ctx: CommsContext = { tenantId: 'T1', branchId: 'B1', userId: 'u1', role: 'OWNER', permissions: ['customers.edit'] };
const soon = new Date(Date.now() + 3 * 86400000).toISOString();
const far = new Date(Date.now() + 40 * 86400000).toISOString();

let repo: InMemoryMembershipCommsRepository;
let svc: MembershipCommsService;

beforeEach(() => {
  repo = new InMemoryMembershipCommsRepository();
  svc = new MembershipCommsService(repo);
  repo.seedMember('m1', { customerId: 'c1', customerName: 'Jordan Lee', planName: 'VIP Nail Club', nextBillingAt: soon, status: 'active' });
  repo.seedMember('m2', { customerId: 'c2', customerName: 'Sam Park', planName: 'Polish Pass', nextBillingAt: far, status: 'active' });        // outside window
  repo.seedMember('m3', { customerId: 'c3', customerName: 'Alex Kim', planName: 'VIP Nail Club', nextBillingAt: soon, status: 'active' }, false); // auto-renew off
});

describe('runRenewalReminders', () => {
  it('notifies active auto-renewing members due within the window, in-app', async () => {
    const r = await svc.runRenewalReminders(ctx, 7);
    expect(r.due).toBe(1);          // only m1 (m2 too far, m3 auto-renew off)
    expect(r.sent).toBe(1);
    expect(repo.notifications).toHaveLength(1);
    expect(repo.notifications[0].customerId).toBe('c1');
    expect(repo.notifications[0].type).toBe('membership');
  });

  it('is idempotent — a second run sends nothing more for the same billing date', async () => {
    await svc.runRenewalReminders(ctx, 7);
    const again = await svc.runRenewalReminders(ctx, 7);
    expect(again.sent).toBe(0);
    expect(again.skipped).toBe(1);
    expect(repo.notifications).toHaveLength(1);
  });
});

describe('sendRenewalReminder', () => {
  it('sends a single member reminder and skips on repeat', async () => {
    const first = await svc.sendRenewalReminder(ctx, 'm1');
    expect(first.sent).toBe(true);
    const second = await svc.sendRenewalReminder(ctx, 'm1');
    expect(second.skipped).toBe(true);
  });

  it('rejects an unknown membership', async () => {
    await expect(svc.sendRenewalReminder(ctx, 'nope')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('runRenewalRemindersDue (cross-tenant system sweep)', () => {
  it('sweeps due members across all tenants, scoping each notification to its own tenant', async () => {
    // m1 (t1) is already due from beforeEach; add m4 in a DIFFERENT tenant, also due.
    repo.seedMember('m4', { customerId: 'c4', customerName: 'Robin Tan', planName: 'Glow Plan', nextBillingAt: soon, status: 'active' }, true, 't2');
    const r = await svc.runRenewalRemindersDue(new Date(), 7, 500);
    expect(r.due).toBe(2);  // m1 (t1) + m4 (t2); m2 far, m3 auto-renew off
    expect(r.sent).toBe(2);
    const byCustomer = Object.fromEntries(repo.notifications.map((n) => [n.customerId, n.tenantId]));
    expect(byCustomer['c1']).toBe('t1');  // m1 scoped to its own tenant
    expect(byCustomer['c4']).toBe('t2');  // m4 scoped to its own tenant — never crosses
  });

  it('is idempotent across tenants on a second run', async () => {
    repo.seedMember('m4', { customerId: 'c4', customerName: 'Robin Tan', planName: 'Glow Plan', nextBillingAt: soon, status: 'active' }, true, 't2');
    await svc.runRenewalRemindersDue(new Date(), 7, 500);
    const again = await svc.runRenewalRemindersDue(new Date(), 7, 500);
    expect(again.sent).toBe(0);
    expect(again.skipped).toBe(2);
    expect(repo.notifications).toHaveLength(2);
  });
});

describe('§151 (Oct 28 2026): renewal and expiry reminders are also TEXTED, in English, through the salon messenger', () => {
  function messenger(answer: (r: any) => any = () => ({ sent: true, status: 'sent' })) {
    const sent: any[] = [];
    return { sent, port: { sendSms: async (r: any) => { sent.push(r); return answer(r); } } };
  }
  const now = new Date();
  const ends = new Date(Date.now() + 4 * 86400000).toISOString();
  it('a due member with a phone gets the in-app reminder AND one text (transactional reminder, not metered, salon name, STOP)', async () => {
    const r2 = new InMemoryMembershipCommsRepository();
    r2.seedMember('m1', { customerId: 'c1', customerName: 'Jordan Lee', planName: 'VIP Nail Club', nextBillingAt: soon, status: 'active' }, true, 'T1', { phone: '+16095550101', salonName: 'Luxe Nails' });
    const m = messenger();
    const s2 = new MembershipCommsService(r2, m.port as any);
    const out = await s2.runRenewalRemindersDue(now, 7, 100);
    expect(out).toMatchObject({ sent: 1, texted: 1 });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ tenantId: 'T1', to: '+16095550101', purpose: 'reminder', customerId: 'c1', meter: false });
    expect(m.sent[0].body).toMatch(/^Luxe Nails: your VIP Nail Club membership renews on .+\. Reply STOP to opt out\.$/);
    expect(m.sent[0].body).not.toMatch(/[À-ỹ]/);   // English only
    // idempotent: a second sweep neither writes nor texts again
    const again = await s2.runRenewalRemindersDue(now, 7, 100);
    expect(again).toMatchObject({ sent: 0, texted: 0 });
    expect(m.sent).toHaveLength(1);
  });
  it('a membership that ENDS without renewing gets one "ends on" reminder — in-app and text', async () => {
    const r2 = new InMemoryMembershipCommsRepository();
    r2.seedMember('m9', { customerId: 'c9', customerName: 'Ana Ruiz', planName: 'Polish Pass', nextBillingAt: null, status: 'canceling' }, false, 'T1', { phone: '+16095550109', salonName: 'Luxe Nails', endsAt: ends });
    const m = messenger();
    const out = await new MembershipCommsService(r2, m.port as any).runRenewalRemindersDue(now, 7, 100);
    expect(out).toMatchObject({ expiring: 1, expirySent: 1, texted: 1 });
    expect(r2.notifications[0]).toMatchObject({ customerId: 'c9', title: 'Your Polish Pass ends soon' });
    expect(m.sent[0].body).toMatch(/Polish Pass membership ends on .+ Ask us if you'd like to renew\. Reply STOP to opt out\.$/);
  });
  it('no phone, no messenger, or a blocked / failing send: the in-app reminder still stands, nothing is retried', async () => {
    const r2 = new InMemoryMembershipCommsRepository();
    r2.seedMember('a', { customerId: 'ca', customerName: 'No Phone', planName: 'P', nextBillingAt: soon, status: 'active' }, true, 'T1', {});
    r2.seedMember('b', { customerId: 'cb', customerName: 'Opted Out', planName: 'P', nextBillingAt: soon, status: 'active' }, true, 'T1', { phone: '+16095550111' });
    r2.seedMember('c', { customerId: 'cc', customerName: 'Provider Down', planName: 'P', nextBillingAt: soon, status: 'active' }, true, 'T1', { phone: '+16095550112' });
    const m = messenger((r) => { if (r.to === '+16095550112') throw new Error('provider down'); return { sent: false, status: 'blocked', reason: 'opted_out' }; });
    const out = await new MembershipCommsService(r2, m.port as any).runRenewalRemindersDue(now, 7, 100);
    expect(out).toMatchObject({ sent: 3, texted: 0 });
    expect(r2.notifications).toHaveLength(3);
    expect(m.sent).toHaveLength(2);   // the phoneless member is never texted
    const none = await new MembershipCommsService(new InMemoryMembershipCommsRepository()).runRenewalRemindersDue(now, 7, 100);
    expect(none.texted).toBe(0);
  });
});
