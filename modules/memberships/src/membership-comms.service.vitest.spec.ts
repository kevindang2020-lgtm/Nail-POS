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
