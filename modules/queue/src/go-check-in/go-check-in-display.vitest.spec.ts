// go-check-in-display.vitest.spec.ts — 23-inch dual-screen spec Unit 7 on the check-in service (in-memory store):
//   §8/§12/§18  a paired customer display checks in on its OWN identity — no kiosk anywhere; revoked → stops at once
//   §15–§19     the visit: every service with its technician; "I'm Here" checks the whole visit in, once
//   §20–§25     the branch's catalog and prices; add-ons with their service; only working, qualified technicians
//   §26–§27     the wait band comes from the server
import { describe, it, expect, beforeEach } from 'vitest';
import { GoCheckInService } from './go-check-in.service';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { minutesOf, type KioskTechFacts } from './go-check-in-rules';

const T = 'tenant-1', B1 = 'branch-cherry', B2 = 'branch-voorhees', T2 = 'tenant-2';
const DISPLAY = { id: 'display-1', tenantId: T, branchId: B2 };
const at = (h: string) => minutesOf(h)!;

function stubCheckIn() {
  const calls: any[] = []; let seq = 0;
  return {
    calls,
    async walkIn(ctx: any, body: any) { calls.push({ m: 'walkIn', ctx, body }); return { checkInId: 'ci_' + ++seq, customerId: body.customerId || 'c_new', customerName: body.customerName, quotedWaitMinutes: 25 }; },
    async appointmentCheckIn(ctx: any, appointmentId: string) { calls.push({ m: 'appointmentCheckIn', ctx, appointmentId }); return { checkInId: 'ci_' + appointmentId, customerId: 'c_sophia', customerName: 'Sophia Lane', quotedWaitMinutes: 15 }; },
    // the whole visit in one call (Oct 6 2026: all or none) — each appointment as appointmentCheckIn records it
    async visitCheckIn(ctx: any, ids: string[]) { calls.push({ m: 'visitCheckIn', ids }); const out = []; for (const id of ids) out.push({ appointmentId: id, row: await (this as any).appointmentCheckIn(ctx, id), duplicate: false }); return out; },
    async moveToQueue(_ctx: any, id: string) { return { moved: true, duplicate: false, queueItemId: 'q_' + id, idempotencyKey: 'k' }; },
    async createCustomer() { return { customerId: 'c_new' }; },
    async technicians() { return []; },
  };
}
const techs = (): KioskTechFacts[] => [
  { technicianId: 'olivia', firstName: 'Olivia', lastName: 'Tran', skills: ['Manicure'], shift: { startMinutes: at('09:00'), endMinutes: at('18:00') }, blocks: [], clockedIn: false, liveStatus: null },
  { technicianId: 'lisa', firstName: 'Lisa', lastName: 'Park', skills: ['Manicure', 'Pedicure'], shift: { startMinutes: at('09:00'), endMinutes: at('18:00') }, blocks: [], clockedIn: false, liveStatus: null },
  { technicianId: 'ava', firstName: 'Ava', lastName: 'Ng', skills: ['Manicure', 'Pedicure'], shift: null, blocks: [], clockedIn: false, liveStatus: null },   // not working today
];

let repo: InMemoryGoCheckInRepository; let checkIn: ReturnType<typeof stubCheckIn>; let svc: GoCheckInService;
beforeEach(async () => {
  repo = new InMemoryGoCheckInRepository();
  checkIn = stubCheckIn();
  svc = new GoCheckInService(repo as any, checkIn as any);
  svc.now = () => new Date('2026-10-06T14:52:00Z');   // 10:52 at the branch (America/New_York)
  // the salon allows asking for a technician (SUNMI guide 4A.9 / migration 990 made the default OFF)
  await repo.upsertSettings(T, { enabled: true, technicianPreferenceEnabled: true });
  repo.seedSalon(T, 'Luxury Nails', B2, 'Voorhees');
  repo.seedDisplay({ ...DISPLAY, usable: true });
  // §23: the same service at two branches, each its own row and price
  repo.seedServices(T, [{ id: 'gel-cherry', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45, category: 'Manicure' }], B1);
  repo.seedServices(T, [
    { id: 'gel-voor', name: 'Gel Manicure', priceCents: 5000, durationMinutes: 45, category: 'Manicure' },
    { id: 'pedi-voor', name: 'Spa Pedicure', priceCents: 6000, durationMinutes: 50, category: 'Pedicure' },
    { id: 'art-voor', name: 'Nail Art', priceCents: 1000, durationMinutes: 15, category: 'Add-ons' },
  ], B2);
  repo.seedTechnicians(T, B2, techs());
  repo.seedCustomer({ tenantId: T, customerId: 'c_sophia', firstName: 'Sophia', lastName: 'Lane', phone: '2155550142' });
});

describe('the display checks in on its own identity (§8, §12, §18)', () => {
  it('a session for the display\'s salon and branch — no kiosk exists, none is needed', async () => {
    expect(await repo.listDevices(T)).toEqual([]);
    const s = await svc.startDisplaySession(DISPLAY);
    expect(s.config).toMatchObject({ salonName: 'Luxury Nails', branchName: 'Voorhees', settings: { enabled: true } });
    expect(await repo.sessionById(s.sessionId)).toMatchObject({ tenantId: T, branchId: B2, deviceId: null, displayDeviceId: 'display-1' });
    expect(await svc.checkInAvailable(T, B2)).toBe(true);
    expect((await svc.services(s.sessionId, s.sessionToken)).services.map((x) => x.id)).toEqual(['gel-voor', 'pedi-voor', 'art-voor']);
    expect((await repo.listLogs(T, 10)).find((l) => l.eventType === 'session_started')).toMatchObject({ sessionId: s.sessionId, metadata: { displayDeviceId: 'display-1' } });
  });

  it('revoked, unpaired or in maintenance: the display\'s check-in stops on the very next request', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    await svc.heartbeat(s.sessionId, s.sessionToken);
    repo.seedDisplay({ ...DISPLAY, usable: false });
    await expect(svc.lookupPhone(s.sessionId, s.sessionToken, '2155550142')).rejects.toMatchObject({ status: 403, code: 'display_unavailable' });
  });

  it('a session can never move to another branch with the display, nor be used by another salon', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    repo.seedDisplay({ ...DISPLAY, branchId: B1, usable: true });
    // Dual-Screen §104: the display moved to another branch — its session's branch no longer matches
    await expect(svc.services(s.sessionId, s.sessionToken)).rejects.toMatchObject({ status: 403, code: 'CHECKIN_BRANCH_MISMATCH' });
    repo.seedDisplay({ id: 'display-1', tenantId: T2, branchId: B2, usable: true });   // same id, another salon: not ours
    repo.seedDisplay({ ...DISPLAY, usable: true });
    const s2 = await svc.startDisplaySession(DISPLAY);
    expect((await repo.sessionById(s2.sessionId))!.tenantId).toBe(T);
  });

  it('the salon\'s check-in switched off, or a display with no branch: no session', async () => {
    await expect(svc.startDisplaySession({ ...DISPLAY, branchId: null })).rejects.toMatchObject({ code: 'no_branch' });
    expect(await svc.checkInAvailable(T, null)).toBe(false);
    await repo.upsertSettings(T, { enabled: false });
    await expect(svc.startDisplaySession(DISPLAY)).rejects.toMatchObject({ status: 403, code: 'disabled' });
    expect(await svc.checkInAvailable(T, B2)).toBe(false);
  });

  it('one session per guest: a fresh session after each guest keeps the per-guest limits per GUEST, not per day', async () => {
    const first = await svc.startDisplaySession(DISPLAY);
    for (let i = 0; i < 8; i++) await svc.lookupPhone(first.sessionId, first.sessionToken, '2155550000');
    await expect(svc.lookupPhone(first.sessionId, first.sessionToken, '2155550000')).rejects.toMatchObject({ status: 429 });   // one guest's ceiling
    await svc.complete(first.sessionId, first.sessionToken);
    const next = await svc.startDisplaySession(DISPLAY);
    expect((await svc.lookupPhone(next.sessionId, next.sessionToken, '2155550142')).match).toMatchObject({ firstName: 'Sophia' });
  });
});

describe('the visit (§15–§19)', () => {
  beforeEach(() => {
    const base = { tenantId: T, branchId: B2, customerId: 'c_sophia', date: '2026-10-06' };
    repo.seedAppointment({ ...base, appointmentId: 'mani', start: '11:00', end: '11:45', items: [{ serviceName: 'Gel Manicure', technicianName: 'Olivia' }] });
    repo.seedAppointment({ ...base, appointmentId: 'pedi', start: '11:00', end: '11:50', items: [{ serviceName: 'Spa Pedicure', technicianName: 'Lisa' }, { serviceName: 'Paraffin Dip', technicianName: 'Lisa' }] });
    repo.seedAppointment({ ...base, appointmentId: 'later', start: '14:00', end: '15:00', items: [{ serviceName: 'Brow Wax', technicianName: 'Ava' }] });
    repo.seedAppointment({ ...base, branchId: B1, appointmentId: 'other-branch', start: '11:00', end: '12:00', items: [{ serviceName: 'Gel Manicure', technicianName: 'Mia' }] });
  });

  it('found: every service of the visit with its technician\'s first name, on the branch\'s clock — not the 2 pm one, not another branch\'s', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    const r = await svc.lookupPhone(s.sessionId, s.sessionToken, '(215) 555-0142');
    expect(r.appointment).toEqual({
      appointmentId: 'mani', startTimeLabel: '11:00 AM', serviceName: 'Gel Manicure', technicianName: 'Olivia',
      items: [
        { serviceName: 'Gel Manicure', technicianName: 'Olivia', startTimeLabel: '11:00 AM' },
        { serviceName: 'Spa Pedicure', technicianName: 'Lisa', startTimeLabel: '11:00 AM' },
        { serviceName: 'Paraffin Dip', technicianName: 'Lisa', startTimeLabel: '11:00 AM' },
      ],
    });
  });

  it('each appointment\'s first service leads — every technician is in the compact rows; their other services follow', async () => {
    svc.now = () => new Date('2026-10-06T17:40:00Z');   // 1:40 pm at the branch: the 2 pm visit
    repo.seedAppointment({ tenantId: T, branchId: B2, customerId: 'c_sophia', date: '2026-10-06', appointmentId: 'a-pedi', start: '14:00', end: '14:50', items: [{ serviceName: 'Spa Pedicure', technicianName: 'Lisa' }, { serviceName: 'Paraffin Dip', technicianName: 'Lisa' }] });
    const s = await svc.startDisplaySession(DISPLAY);
    const r = await svc.lookupPhone(s.sessionId, s.sessionToken, '(215) 555-0142');
    expect(r.appointment?.items?.map((i) => `${i.serviceName}/${i.technicianName}`)).toEqual(['Spa Pedicure/Lisa', 'Brow Wax/Ava', 'Paraffin Dip/Lisa']);
    expect(r.appointment).toMatchObject({ appointmentId: 'a-pedi', serviceName: 'Spa Pedicure', technicianName: 'Lisa', startTimeLabel: '2:00 PM' });
  });

  it('"I\'m Here" checks in every appointment of that visit — once: a second tap finds them checked in', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    const c = await svc.checkInAppointment(s.sessionId, s.sessionToken, 'mani');
    expect(checkIn.calls.filter((x) => x.m === 'appointmentCheckIn').map((x) => x.appointmentId)).toEqual(['mani', 'pedi']);
    expect(checkIn.calls.filter((x) => x.m === 'visitCheckIn').map((x) => x.ids)).toEqual([['mani', 'pedi']]);   // one call: all or none
    expect(c).toMatchObject({ status: 'checked_in', firstName: 'Sophia', appointmentsCheckedIn: 2, estimatedWait: { fromMinutes: 15, toMinutes: 25 }, checkInId: 'q_ci_mani' });
    expect(checkIn.calls.find((x) => x.m === 'appointmentCheckIn').ctx).toMatchObject({ tenantId: T, branchId: B2, userId: 'display:display-1', role: 'KIOSK' });
    repo.setAppointmentStatus('mani', 'checked_in'); repo.setAppointmentStatus('pedi', 'checked_in');
    expect(await svc.checkInAppointment(s.sessionId, s.sessionToken, 'mani')).toMatchObject({ status: 'already_checked_in', firstName: 'Sophia' });
  });

  it('another branch\'s or a forged appointment id is not found — nothing is checked in', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    for (const id of ['other-branch', 'nope', '']) await expect(svc.checkInAppointment(s.sessionId, s.sessionToken, id)).rejects.toMatchObject({ status: 404, code: 'CHECKIN_APPOINTMENT_NOT_FOUND' });
    expect(checkIn.calls.filter((x) => x.m === 'appointmentCheckIn')).toEqual([]);
  });
});

describe('the walk-in (§20–§27)', () => {
  it('§25: only technicians working today and qualified for the chosen services; asked again as services change', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    expect((await svc.technicians(s.sessionId, s.sessionToken)).technicians.map((t) => t.name)).toEqual(['Lisa', 'Olivia']);   // Ava is off today
    expect((await svc.technicians(s.sessionId, s.sessionToken, ['gel-voor', 'pedi-voor'])).technicians.map((t) => t.technicianId)).toEqual(['lisa']);
    expect((await svc.technicians(s.sessionId, s.sessionToken, ['gel-voor', 'art-voor'])).technicians.map((t) => t.technicianId)).toEqual(['lisa', 'olivia']);   // add-ons need no skill
  });

  it('a preferred technician who is not qualified (or not working) is refused; "Any available" always works', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    const base = { customerName: 'Mia', phone: '2155550199', serviceIds: ['gel-voor', 'pedi-voor'] };
    await expect(svc.checkInWalkIn(s.sessionId, s.sessionToken, { ...base, technicianId: 'olivia' })).rejects.toMatchObject({ code: 'technician_unavailable' });
    await expect(svc.checkInWalkIn(s.sessionId, s.sessionToken, { ...base, technicianId: 'ava' })).rejects.toMatchObject({ code: 'technician_unavailable' });
    expect(checkIn.calls.filter((x) => x.m === 'walkIn')).toEqual([]);
    const ok = await svc.checkInWalkIn(s.sessionId, s.sessionToken, { ...base, technicianId: 'lisa' });
    expect(checkIn.calls.find((x) => x.m === 'walkIn').body.technicianId).toBe('lisa');
    expect(ok).toMatchObject({ status: 'checked_in', firstName: 'Mia', estimatedWait: { fromMinutes: 25, toMinutes: 35 }, estimatedServiceMinutes: 95 });
  });

  it('§23: another branch\'s service (its own price) is refused; add-ons go with the first service', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    await expect(svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', serviceIds: ['gel-cherry'] })).rejects.toMatchObject({ code: 'unknown_service' });
    await expect(svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', serviceIds: [], addOnIds: ['art-voor'] })).rejects.toMatchObject({ code: 'add_on_needs_service' });
    await expect(svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', serviceIds: ['gel-voor'], addOnIds: ['pedi-voor'] })).rejects.toMatchObject({ code: 'not_an_add_on' });
    const c = await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: '  Mia  ', serviceIds: ['gel-voor'], addOnIds: ['art-voor'] });
    expect(checkIn.calls.find((x) => x.m === 'walkIn').body).toMatchObject({
      customerName: 'Mia', serviceIds: ['gel-voor', 'art-voor'],
      serviceLines: [{ serviceId: 'gel-voor' }, { serviceId: 'art-voor', isAddon: true, parentServiceId: 'gel-voor' }],
    });
    expect(c.estimatedServiceMinutes).toBe(60);
  });

  it('a service is required while the salon offers the choice; with the choice switched off the guest joins without one', async () => {
    const s = await svc.startDisplaySession(DISPLAY);
    await expect(svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', serviceIds: [] })).rejects.toMatchObject({ code: 'no_service' });
    await repo.upsertSettings(T, { serviceSelectionEnabled: false });
    await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', serviceIds: [] });
    expect(checkIn.calls.find((x) => x.m === 'walkIn').body).toMatchObject({ serviceIds: [], allowNoServices: true });
    expect((await svc.services(s.sessionId, s.sessionToken)).services).toEqual([]);
  });

  it('technician choice switched off by the salon: no list, and a technician in the request is ignored (Any available)', async () => {
    await repo.upsertSettings(T, { technicianPreferenceEnabled: false });
    const s = await svc.startDisplaySession(DISPLAY);
    expect((await svc.technicians(s.sessionId, s.sessionToken)).technicians).toEqual([]);
    await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', serviceIds: ['gel-voor'], technicianId: 'olivia' });
    expect(checkIn.calls.find((x) => x.m === 'walkIn').body.technicianId).toBeUndefined();
  });

  it('§27: the wait band is the server\'s — and withheld entirely when the salon hides the estimate', async () => {
    await repo.upsertSettings(T, { showWaitEstimate: false });
    const s = await svc.startDisplaySession(DISPLAY);
    const c = await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', serviceIds: ['gel-voor'] });
    expect(c.estimatedWait).toBeUndefined();
    expect(c.estimatedWaitMinutes).toBeUndefined();
  });
});

describe('B-82 (Oct 23 2026): the kiosk list follows the EXACT service rule when the authority is bound', () => {
  const approvedOnly = (ok: Record<string, string[]>) => ({ calls: [] as any[], async eligibleAmong(i: any) {
    this.calls.push(i);
    return new Map(i.technicianIds.map((id: string) => [id, i.serviceIds.every((s: string) => (ok[id] ?? []).includes(s)) ? { eligible: true } : { eligible: false, code: 'TECHNICIAN_NOT_SKILLED' }]));
  } });
  it('Olivia shares the gel category but is not approved for gel: she is not offered, and a forged request for her is refused', async () => {
    const el = approvedOnly({ lisa: ['gel-voor', 'pedi-voor'], olivia: [] });
    svc.eligibility = el;
    const s = await svc.startDisplaySession(DISPLAY);
    expect((await svc.technicians(s.sessionId, s.sessionToken, ['gel-voor'])).technicians.map((t) => t.technicianId)).toEqual(['lisa']);
    expect(el.calls[0]).toMatchObject({ tenantId: T, branchId: B2, serviceIds: ['gel-voor'] });
    await expect(svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Mia', phone: '2155550199', serviceIds: ['gel-voor'], technicianId: 'olivia' })).rejects.toMatchObject({ code: 'technician_unavailable' });
    expect(checkIn.calls.filter((x) => x.m === 'walkIn')).toEqual([]);
  });
  it('§24 (Kevin, Oct 27 2026): with the authority bound the category pre-filter does not hide anyone — a technician with no services set up (no category skills yet) is offered when the authority\'s fallback says yes', async () => {
    const all = { calls: [] as any[], async eligibleAmong(i: any) { this.calls.push(i); return new Map(i.technicianIds.map((id: string) => [id, { eligible: true, basis: id === 'olivia' ? 'category_fallback_unconfigured' : 'exact' }])); } };
    svc.eligibility = all;
    const s = await svc.startDisplaySession(DISPLAY);
    const listed = (await svc.technicians(s.sessionId, s.sessionToken, ['pedi-voor'])).technicians.map((t) => t.technicianId).sort();
    expect(all.calls[0].technicianIds.sort()).toEqual(['lisa', 'olivia']);   // both working today reach the authority
    expect(listed).toEqual(['lisa', 'olivia']);
  });
  it('no services chosen yet → the authority is not asked (everyone working today is listed)', async () => {
    const el = approvedOnly({}); svc.eligibility = el;
    const s = await svc.startDisplaySession(DISPLAY);
    expect((await svc.technicians(s.sessionId, s.sessionToken)).technicians.map((t) => t.name)).toEqual(['Lisa', 'Olivia']);
    expect(el.calls).toEqual([]);
  });
});
