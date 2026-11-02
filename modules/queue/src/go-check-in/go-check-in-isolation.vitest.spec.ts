import { describe, it, expect, beforeEach } from 'vitest';
import { GoCheckInService, GoCheckInError } from './go-check-in.service';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { sha256Hex, newToken } from './go-check-in.dto';

// A focused CheckInService stub: records the tenant/branch it was called with (to prove the kiosk acts only on the
// device's tenant) and returns synthetic rows. The security logic under test lives in GoCheckInService, not here.
function stubCheckIn() {
  const calls: any[] = [];
  let seq = 0;
  return {
    calls,
    async createCustomer(ctx: any, body: any) { calls.push({ m: 'createCustomer', tenantId: ctx.tenantId, branchId: ctx.branchId, smsOptIn: body.smsOptIn }); return { customerId: 'new_' + ++seq, fullName: body.fullName }; },
    async walkIn(ctx: any, body: any) { calls.push({ m: 'walkIn', tenantId: ctx.tenantId, branchId: ctx.branchId, body }); return { checkInId: 'ci_' + ++seq, customerId: body.customerId || ('cust_' + seq), customerName: body.customerName, quotedWaitMinutes: 5 }; },
    async appointmentCheckIn(ctx: any, appointmentId: string) { calls.push({ m: 'appointmentCheckIn', tenantId: ctx.tenantId, appointmentId }); return { checkInId: 'ci_' + ++seq, customerId: 'cust_appt', customerName: 'Appt Customer', quotedWaitMinutes: 5 }; },
    // the whole visit in one call (Oct 6 2026: all or none) — each appointment as appointmentCheckIn records it
    async visitCheckIn(ctx: any, ids: string[]) { calls.push({ m: 'visitCheckIn', ids }); const out = []; for (const id of ids) out.push({ appointmentId: id, row: await (this as any).appointmentCheckIn(ctx, id), duplicate: false }); return out; },
    async technicians(ctx: any) { calls.push({ m: 'technicians', tenantId: ctx.tenantId }); return [{ technicianId: 't1', name: 'Tess', available: true }]; },
    async moveToQueue(ctx: any, id: string) { calls.push({ m: 'moveToQueue', tenantId: ctx.tenantId, branchId: ctx.branchId, id }); return { moved: true, duplicate: false, queueItemId: 'q_' + id, idempotencyKey: 'k' }; },
  };
}

const A = 'tenant-A'; const BA = 'branch-A';
const B = 'tenant-B'; const BB = 'branch-B';

async function setup() {
  const repo = new InMemoryGoCheckInRepository();
  const checkIn = stubCheckIn();
  const svc = new GoCheckInService(repo as any, checkIn as any);
  // Tenant A device (slug 'a'), enabled
  const devA = await repo.createDevice({ tenantId: A, branchId: BA, deviceName: 'A Kiosk', checkinSlug: 'a' });
  const tokA = newToken(); await repo.setDeviceToken(A, devA.id, sha256Hex(tokA));
  await repo.upsertSettings(A, { enabled: true });
  // Tenant B device (slug 'b'), enabled — used to prove cross-tenant separation
  const devB = await repo.createDevice({ tenantId: B, branchId: BB, deviceName: 'B Kiosk', checkinSlug: 'b' });
  await repo.upsertSettings(B, { enabled: true });
  // the catalog the walk-ins below choose from (Unit 7: a walk-in's services must be its branch's)
  repo.seedServices(A, [{ id: 'svc1', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }]);
  return { repo, checkIn, svc, devA, devB };
}

describe('Go Check-In tenant isolation', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { env = await setup(); });

  // ---- SMS consent capture at check-in: explicit opt-in only, safe default ----
  it('new-customer SMS consent flows through only when the guest checks the box', async () => {
    const s = await env.svc.startSession('a');
    await env.svc.createCustomer(s.sessionId, s.sessionToken, { firstName: 'Opt', lastName: 'In', phone: '6095551212', smsConsent: true });
    expect(env.checkIn.calls.find((c) => c.m === 'createCustomer').smsOptIn).toBe(true);
  });

  it('new customer is NOT opted in by default (no consent flag → smsOptIn false)', async () => {
    const s = await env.svc.startSession('a');
    await env.svc.createCustomer(s.sessionId, s.sessionToken, { firstName: 'No', lastName: 'Consent', phone: '6095551213' });
    expect(env.checkIn.calls.find((c) => c.m === 'createCustomer').smsOptIn).toBe(false);
  });

  it('resolves tenant from the device slug — config never takes a client tenantId', async () => {
    const cfg = await env.svc.getConfig('a');
    expect(cfg.settings.enabled).toBe(true);
  });

  // ---- multi-branch end-to-end: the chosen branch must flow all the way to the POS queue handoff ----
  it('multi-branch: a walk-in at the CHOSEN branch hands off to the queue with that branch, not the device default', async () => {
    const dev = await env.repo.createDevice({ tenantId: A, branchId: BA, allowedBranchIds: ['branch-A2'], deviceName: 'Shared Desk', checkinSlug: 'a-multi' });
    const tok = newToken(); await env.repo.setDeviceToken(A, dev.id, sha256Hex(tok));
    const s = await env.svc.startSession('a-multi', 'branch-A2');                       // guest picks the 2nd location
    await env.svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerId: 'A-cust', customerName: 'Alice', serviceIds: ['svc1'] });
    const wi = env.checkIn.calls.find((c) => c.m === 'walkIn');
    const mq = env.checkIn.calls.find((c) => c.m === 'moveToQueue');
    expect(wi.branchId).toBe('branch-A2');                                               // check-in written for the chosen branch
    expect(mq.branchId).toBe('branch-A2');                                               // → enqueue writes pos_queue_items.branch_id = chosen branch
  });

  it('multi-branch: with no choice, the default branch is used end-to-end', async () => {
    const dev = await env.repo.createDevice({ tenantId: A, branchId: BA, allowedBranchIds: ['branch-A2'], deviceName: 'Shared Desk 2', checkinSlug: 'a-multi-def' });
    const tok = newToken(); await env.repo.setDeviceToken(A, dev.id, sha256Hex(tok));
    const s = await env.svc.startSession('a-multi-def');                                 // no branch chosen
    await env.svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerId: 'A-cust', customerName: 'Bob', serviceIds: ['svc1'] });
    expect(env.checkIn.calls.find((c) => c.m === 'moveToQueue').branchId).toBe(BA);
  });

  it('multi-branch: a branch outside the allow-list is rejected and nothing is checked in', async () => {
    const dev = await env.repo.createDevice({ tenantId: A, branchId: BA, allowedBranchIds: ['branch-A2'], deviceName: 'Shared Desk 3', checkinSlug: 'a-multi-rogue' });
    const tok = newToken(); await env.repo.setDeviceToken(A, dev.id, sha256Hex(tok));
    await expect(env.svc.startSession('a-multi-rogue', 'branch-ROGUE')).rejects.toMatchObject({ code: 'CHECKIN_BRANCH_MISMATCH' });
    expect(env.checkIn.calls.length).toBe(0);
  });

  it('phone lookup searches the TENANT customer first (same phone in A and B → returns A)', async () => {
    env.repo.seedCustomer({ tenantId: A, customerId: 'A-cust', firstName: 'Alice', lastName: 'Anderson', phone: '856-555-1000' });
    env.repo.seedCustomer({ tenantId: B, customerId: 'B-cust', firstName: 'Bob', lastName: 'Brown', phone: '856-555-1000' });
    const s = await env.svc.startSession('a');
    const r = await env.svc.lookupPhone(s.sessionId, s.sessionToken, '(856) 555-1000');
    expect(r.match?.source).toBe('tenant');
    expect(r.foundInTenant).toBe(true);
    expect((r.match as any).customerId).toBe('A-cust'); // A's customer, never B's
  });

  it('central lookup returns ONLY safe fields (phone only in B, looked up from A)', async () => {
    env.repo.seedCustomer({ tenantId: B, customerId: 'B-only', firstName: 'Carol', lastName: 'Carter', email: 'carol@example.com', phone: '856-555-2000' });
    const s = await env.svc.startSession('a');
    const r = await env.svc.lookupPhone(s.sessionId, s.sessionToken, '856 555 2000');
    expect(r.match?.source).toBe('central');
    expect(r.foundInTenant).toBe(false);
    const m: any = r.match;
    expect(m.firstName).toBe('Carol');
    expect(m.lastInitial).toBe('C.');              // last initial only, not full last name
    expect(m.maskedEmail).toBe('c****@example.com'); // masked
    expect(m.customerId).toBeUndefined();           // NO cross-tenant id leaked
    expect(m.lastName).toBeUndefined();             // NO full last name
    expect(m.email).toBeUndefined();                // NO raw email
  });

  it('returns no match when the phone is unknown (and offers create per settings)', async () => {
    const s = await env.svc.startSession('a');
    const r = await env.svc.lookupPhone(s.sessionId, s.sessionToken, '856-555-9999');
    expect(r.match).toBeNull();
    expect(r.canCreate).toBe(true);
  });

  it('a disabled device cannot start a session', async () => {
    await env.repo.setDeviceStatus(A, env.devA.id, 'disabled');
    await expect(env.svc.startSession('a')).rejects.toMatchObject({ status: 403 });
  });

  it('a disabled master switch blocks the kiosk', async () => {
    await env.repo.upsertSettings(A, { enabled: false });
    await expect(env.svc.startSession('a')).rejects.toMatchObject({ status: 403, code: 'disabled' });
  });

  it('an invalid session token is rejected', async () => {
    const s = await env.svc.startSession('a');
    await expect(env.svc.lookupPhone(s.sessionId, 'WRONG-TOKEN', '856-555-1000')).rejects.toMatchObject({ status: 401 });
  });

  it('an expired (idle) session is rejected', async () => {
    const s = await env.svc.startSession('a');
    const session: any = await env.repo.sessionById(s.sessionId);
    session.lastSeenAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min idle
    await expect(env.svc.lookupPhone(s.sessionId, s.sessionToken, '856-555-1000')).rejects.toMatchObject({ status: 410, code: 'session_expired' });
  });

  it('an old device token no longer resolves after regeneration', async () => {
    const before = await env.repo.deviceByTokenHash(sha256Hex('whatever')); // sanity: nothing matches a random hash
    expect(before).toBeNull();
    const first = await env.repo.deviceById(A, env.devA.id);
    const oldHash = first!.deviceTokenHash!;
    await env.svc.regenerateToken(A, env.devA.id);
    expect(await env.repo.deviceByTokenHash(oldHash)).toBeNull(); // old hash dead
  });

  it('a NEW customer is created under the device tenant (A), never B', async () => {
    const s = await env.svc.startSession('a');
    await env.svc.createCustomer(s.sessionId, s.sessionToken, { firstName: 'New', lastName: 'Guest', phone: '856-555-3000' });
    const created = env.checkIn.calls.find((c) => c.m === 'createCustomer');
    expect(created.tenantId).toBe(A);
    expect(created.branchId).toBe(BA);
  });

  it('walk-in check-in acts only on the device tenant/branch (A)', async () => {
    const s = await env.svc.startSession('a');
    await env.svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerId: 'A-cust', customerName: 'Alice', serviceIds: ['svc1'] });
    const wi = env.checkIn.calls.find((c) => c.m === 'walkIn');
    expect(wi.tenantId).toBe(A);
    expect(wi.branchId).toBe(BA);
    const mq = env.checkIn.calls.find((c) => c.m === 'moveToQueue');
    expect(mq.tenantId).toBe(A); // queue item created under A
  });

  it('prevents a duplicate walk-in for the same customer the same day', async () => {
    const s = await env.svc.startSession('a');
    const first = await env.svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerId: 'dup-cust', customerName: 'Dup', serviceIds: ['svc1'] });
    expect(first.status).toBe('checked_in');
    const second = await env.svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerId: 'dup-cust', customerName: 'Dup', serviceIds: ['svc1'] });
    expect(second.status).toBe('already_checked_in');
    // walkIn should have been invoked once only (the 2nd was blocked before reaching CheckInService)
    expect(env.checkIn.calls.filter((c) => c.m === 'walkIn').length).toBe(1);
  });

  it('rate-limits phone lookups within a session', async () => {
    const s = await env.svc.startSession('a');
    for (let i = 0; i < 8; i++) await env.svc.lookupPhone(s.sessionId, s.sessionToken, '856-555-0000');
    await expect(env.svc.lookupPhone(s.sessionId, s.sessionToken, '856-555-0000')).rejects.toMatchObject({ status: 429 });
  });

  it('writes a safe Super-Admin log trail (no raw PII)', async () => {
    const s = await env.svc.startSession('a');
    await env.svc.lookupPhone(s.sessionId, s.sessionToken, '856-555-1234');
    const logs = await env.repo.listLogs(A, 50);
    const events = logs.map((l) => l.eventType);
    expect(events).toContain('session_started');
    expect(events).toContain('phone_entered');
    // the phone_entered log keeps only last-4, never the full number
    const pe = logs.find((l) => l.eventType === 'phone_entered');
    expect(JSON.stringify(pe!.metadata)).toContain('1234');
    expect(JSON.stringify(pe!.metadata)).not.toContain('856555');
  });
});

// ---- realtime emission (POS live updates) ----
function fakeRt() {
  const events: any[] = [];
  return { events,
    toTenant: (ctx: any, event: any, payload: any) => events.push({ ctx, event, payload }),
    toTechnician: () => {}, toTicket: () => {}, toOwner: () => {} };
}

describe('Go Check-In realtime emission', () => {
  async function rtSetup() {
    const repo = new InMemoryGoCheckInRepository();
    const checkIn = stubCheckIn();
    const rt = fakeRt();
    const svc = new GoCheckInService(repo as any, checkIn as any, rt as any);
    const dev = await repo.createDevice({ tenantId: A, branchId: BA, deviceName: 'A', checkinSlug: 'a' });
    await repo.setDeviceToken(A, dev.id, sha256Hex(newToken()));
    await repo.upsertSettings(A, { enabled: true });
    repo.seedServices(A, [{ id: 'svc1', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }]);
    svc.now = () => new Date('2026-10-06T15:00:00Z');   // 11:00 in the branch (America/New_York)
    repo.seedAppointment({ tenantId: A, branchId: BA, customerId: 'c9', date: '2026-10-06', appointmentId: 'appt-9', start: '11:00', end: '11:45', items: [{ serviceName: 'Gel Manicure', technicianName: 'Olivia' }] });
    const s = await svc.startSession('a');
    return { repo, checkIn, rt, svc, s };
  }

  it('emits customer_checked_in + queue_updated to the tenant/branch on a walk-in', async () => {
    const { svc, rt, s } = await rtSetup();
    await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerId: 'c1', customerName: 'Alice', serviceIds: ['svc1'] });
    const names = rt.events.map((e) => e.event);
    expect(names).toContain('customer_checked_in');
    expect(names).toContain('queue_updated');
    const ci = rt.events.find((e) => e.event === 'customer_checked_in');
    expect(ci.ctx.tenantId).toBe(A);
    expect(ci.ctx.branchId).toBe(BA);          // scoped to the device's room — never another tenant's
    expect(ci.payload.source).toBe('walk_in');
  });

  it('emits appointment_updated + customer_checked_in on an appointment check-in', async () => {
    const { svc, rt, s } = await rtSetup();
    await svc.checkInAppointment(s.sessionId, s.sessionToken, 'appt-9');
    const names = rt.events.map((e) => e.event);
    expect(names).toContain('appointment_updated');
    expect(names).toContain('customer_checked_in');
    expect(rt.events.find((e) => e.event === 'customer_checked_in').payload.source).toBe('appointment');
  });
});

// ---- §8 multiple-customer-match safety ----
describe('Go Check-In ambiguous phone match', () => {
  it('never auto-selects when 2+ tenant profiles share a phone — routes to the front desk + raises a staff alert', async () => {
    const repo = new InMemoryGoCheckInRepository();
    const svc = new GoCheckInService(repo as any, stubCheckIn() as any);
    const dev = await repo.createDevice({ tenantId: A, branchId: BA, deviceName: 'A', checkinSlug: 'a' });
    await repo.setDeviceToken(A, dev.id, sha256Hex(newToken()));
    await repo.upsertSettings(A, { enabled: true });
    repo.seedCustomer({ tenantId: A, firstName: 'Sam', lastName: 'Park', phone: '856-555-7777' });
    repo.seedCustomer({ tenantId: A, firstName: 'Sandra', lastName: 'Quinn', phone: '856-555-7777' });
    const s = await svc.startSession('a');
    const r = await svc.lookupPhone(s.sessionId, s.sessionToken, '856-555-7777');
    expect(r.match).toBeNull();              // not auto-selected
    expect(r.ambiguous).toBe(true);
    expect(r.askFrontDesk).toBe(true);
    expect(r.canCreate).toBe(false);         // don't offer "new profile" either
    expect(r.choices?.length).toBe(2);
    expect(r.choices?.[0]).toMatchObject({ firstName: 'Sam', lastInitial: 'P.' }); // safe labels only
    const logs = await repo.listLogs(A, 20);
    const alert = logs.find((l) => l.eventType === 'ambiguous_match');
    expect(alert).toBeTruthy();
    expect(alert!.metadata.staffAlert).toBe(true);
  });
});
