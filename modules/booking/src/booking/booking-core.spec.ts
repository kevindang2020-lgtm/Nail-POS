// booking-core.spec.ts — Nest-free harness for the Booking service + repository + pure dto helpers.
// The repository/service are async (Postgres-backed in prod via the Kysely adapter); service assertions are awaited.
import { InMemoryBookingRepository, BookingContext } from './booking.repository';
import { BookingService, ForbiddenError, ValidationError, ConflictError } from './booking.service';
import { pbAddMinutes, pbDuration, pbWithinStoreHours, pbDetectTechnicianConflict, pbDetectCustomerOverlap, pbComputeAvailability, pbCanCheckIn, pbCanStartService, pbServingKey, pbSearch, computeBookingAggregates } from './booking.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsP = async (n: string, fn: () => Promise<unknown>, t?: any) => { try { await fn(); fail++; console.error('FAIL (no throw):', n); } catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n, '(got', (e as Error).name + ')'); } else pass++; } };

const svc = () => new BookingService(new InMemoryBookingRepository());
const PERMS = ['pos.booking.view','pos.booking.create','pos.booking.edit','pos.booking.reschedule','pos.booking.cancel','pos.booking.no_show','pos.booking.check_in','pos.booking.assign_technician','pos.booking.override_conflict','pos.queue.create','pos.tech_queue.create','pos.serving.start','pos.reports.view'];
const owner = (over: Partial<BookingContext> = {}): BookingContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });
const TODAY = '2026-06-06';

// ---- pure helpers (sync) ----
ok('pbAddMinutes', pbAddMinutes('10:00', 45) === '10:45');
ok('pbAddMinutes crosses hour', pbAddMinutes('10:50', 20) === '11:10');
ok('pbDuration sums', pbDuration([{ durationMinutes: 45 }, { durationMinutes: 15 }]) === 60);
ok('pbWithinStoreHours true', pbWithinStoreHours('10:00', '10:45', '09:00', '19:00'));
ok('pbWithinStoreHours false', !pbWithinStoreHours('18:45', '19:30', '09:00', '19:00'));
const ex = [{ appointmentId: 'a1', technicianId: 't1', startTime: '10:00', endTime: '10:45', status: 'booked' as const }];
ok('conflict overlap', pbDetectTechnicianConflict(ex, 't1', '10:30', '11:00', 0).status === 'conflict');
ok('conflict buffer', pbDetectTechnicianConflict(ex, 't1', '10:50', '11:20', 10).status === 'conflict');
ok('conflict other tech ok', pbDetectTechnicianConflict(ex, 't2', '10:30', '11:00', 0).status === 'none');
ok('conflict ignore self', pbDetectTechnicianConflict(ex, 't1', '10:00', '10:45', 0, 'a1').status === 'none');
ok('customer overlap', pbDetectCustomerOverlap([{ appointmentId: 'a1', customerId: 'c1', startTime: '10:00', endTime: '10:45', status: 'booked' }], 'c1', '10:30', '11:00'));
ok('availability excludes busy slots', (() => { const slots = pbComputeAvailability('09:00', '11:00', 30, 30, 0, [{ startTime: '10:00', endTime: '10:30', status: 'booked' }]); return slots.includes('09:00') && slots.includes('09:30') && !slots.includes('10:00') && slots.includes('10:30'); })());
ok('canCheckIn booked', pbCanCheckIn('booked') && !pbCanCheckIn('in_service'));
ok('canStartService blocks completed', !pbCanStartService('completed').ok && pbCanStartService('checked_in').ok);
ok('idempotency stable', pbServingKey('bk1') === 'bk1:start_service');
ok('search matches service', pbSearch([{ appointmentId: 'a', tenantId: 't', customerName: 'X', source: 'phone', services: [{ serviceId: 's', serviceName: 'Gel Manicure', durationMinutes: 30 }], startTime: '10:00', endTime: '10:30', durationMinutes: 30, status: 'booked', createdAt: '', updatedAt: '' }], 'gel').length === 1);

(async () => {
  // ---- access ----
  await throwsP('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsP('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsP('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsP('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.bookings.items.length === 0 && other.kpis.totalBookingsToday === 0 && other.filters.technicians.length === 0);

  // ---- state + KPIs + deposits ----
  const st = await svc().getState(owner());
  ok('seed has bookings today', st.bookings.items.length >= 6);
  ok('kpis total', st.kpis.totalBookingsToday >= 8);
  ok('kpis source breakdown', st.kpis.onlineBookings >= 1 && st.kpis.googleBookings >= 1 && st.kpis.aiBookings >= 1);
  ok('kpis statuses', st.kpis.inServiceBookings >= 1 && st.kpis.completedBookings >= 1 && st.kpis.cancelledBookings >= 1 && st.kpis.noShowBookings >= 1);
  ok('kpis deposits collected', st.kpis.depositsCollectedCents >= 3500);
  ok('rows carry conflict + deposit status', st.bookings.items.every((a) => !!a.conflictStatus && !!a.depositStatus));
  ok('dateRange present', st.dateRange.from === TODAY && !!st.dateRange.timezone);
  ok('facets present', st.filters.statuses.includes('in_service') && st.filters.sources.includes('google'));
  ok('settings exposed', st.settings.slotIntervalMinutes === 15 && st.settings.preventDoubleBooking === true);
  ok('pagination present', !!st.bookings.pagination && st.bookings.pagination!.page === 1);

  // ---- integration status (honest, not faked) ----
  const integ = await svc().integrationStatus(owner());
  ok('integration honest not_configured', integ.onlineBooking === 'not_configured' && integ.googleBooking === 'not_configured' && integ.aiBooking === 'not_configured' && integ.customerAppBooking === 'not_configured');

  // ---- filters ----
  ok('filter status=booked', (await svc().appointments(owner(), { status: 'booked' })).items.every((a) => a.status === 'booked'));
  ok('filter source=google', (await svc().appointments(owner(), { source: 'google' })).items.every((a) => a.source === 'google'));
  ok('filter technician', (await svc().appointments(owner(), { technicianId: 'tech_mia' })).items.every((a) => a.technicianId === 'tech_mia'));
  ok('filter depositStatus=paid', (await svc().appointments(owner(), { depositStatus: 'paid' })).items.every((a) => a.depositStatus === 'paid'));
  ok('search by customer', (await svc().appointments(owner(), { search: 'Grace' })).items.length >= 1);

  // ---- detail ----
  const d = await svc().detail(owner(), 'bk_5101');
  ok('detail has services + tech name', d.services.length >= 1 && d.technicianName === 'Mia');

  // ---- availability ----
  const avail = await svc().availability(owner(), { date: TODAY, serviceIds: ['svc_mani'], technicianId: 'tech_mia' });
  ok('availability returns slots for tech', avail.length === 1 && avail[0].technicianId === 'tech_mia' && avail[0].slots.length > 0);
  ok('availability omits the 10:00 booked slot for mia', !avail[0].slots.includes('10:00'));
  ok('availability empty for unavailable tech', (await svc().availability(owner(), { date: TODAY, technicianId: 'tech_leo' }))[0].slots.length === 0);

  // ---- conflict check ----
  ok('conflict check finds mia 10:00 overlap', (await svc().checkConflict(owner(), { technicianId: 'tech_mia', startTime: '10:15', endTime: '10:45' })).status === 'conflict');
  ok('conflict check clear slot', (await svc().checkConflict(owner(), { technicianId: 'tech_mia', startTime: '17:00', endTime: '17:30' })).status === 'none');

  // ---- create ----
  const s2 = svc();
  await throwsP('create requires customer', () => svc().create(owner(), { customerName: '', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsP('create requires service', () => svc().create(owner(), { customerName: 'X', serviceIds: [], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsP('create unknown service rejected', () => svc().create(owner(), { customerName: 'X', serviceIds: ['nope'], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsP('create outside hours rejected', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: 'X', serviceIds: ['svc_mani'], date: TODAY, startTime: '20:00' } as any), ValidationError);
  await throwsP('create ineligible tech rejected', () => svc().create(owner(), { technicianId: 'tech_leo', customerName: 'X', serviceIds: ['svc_pedi'], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsP('create double-book rejected', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: 'X', serviceIds: ['svc_mani'], date: TODAY, startTime: '10:15' } as any), ConflictError);
  ok('create valid booking', !!(await s2.create(owner(), { technicianId: 'tech_mia', customerName: 'New Guest', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:00', source: 'walk_in' })).appointmentId);
  ok('create unassigned booking allowed', !!(await s2.create(owner(), { customerName: 'No Tech Yet', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:30' })).appointmentId);
  // Smooth Refresh spec §11 (P3, Sep 30): the default overbooking policy is BLOCK — a conflict is refused even with
  // managerOverride. Overbooking under WARN / ALLOW_AUTHORIZED_ROLE (reason, audit) is covered in
  // booking-overbooking-policy.vitest.spec.ts. This check predated P3 and crashed the harness from Sep 30.
  await throwsP('BLOCK policy: a manager override does not double-book', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: 'Ov', serviceIds: ['svc_mani'], date: TODAY, startTime: '10:15', managerOverride: true } as any), ConflictError);
  ok('audit: created', s2.auditLog().some((l) => l.actionType === 'pos_booking_appointment_created'));

  // ---- edit ----
  const s3 = svc();
  ok('edit updates services + duration', await (async () => { const r = await s3.update(owner(), 'bk_5105', { serviceIds: ['svc_mani', 'svc_gel'] }); return r.services.length === 2 && r.durationMinutes === 60; })());

  // ---- reschedule ----
  const s4 = svc();
  ok('reschedule to clear slot', (await s4.reschedule(owner(), 'bk_5105', { startTime: '17:30' })).startTime === '17:30');
  await throwsP('reschedule into conflict rejected', () => svc().reschedule(owner(), 'bk_5105', { startTime: '10:15', technicianId: 'tech_mia' }), ConflictError);
  await throwsP('reschedule outside hours rejected', () => svc().reschedule(owner(), 'bk_5105', { startTime: '20:00' }), ValidationError);
  ok('audit: rescheduled', s4.auditLog().some((l) => l.actionType === 'pos_booking_appointment_rescheduled'));

  // ---- assign / check-in / cancel / no-show ----
  const s5 = svc();
  ok('assign eligible technician', (await s5.assignTechnician(owner(), 'bk_5105', { technicianId: 'tech_zoe' })).technicianName === 'Zoe');
  await throwsP('assign ineligible rejected', () => svc().assignTechnician(owner(), 'bk_5103', { technicianId: 'tech_zoe' }), ValidationError);
  // Merge Oct 12 2026 (booking concurrency): a reassign is a write of the NEW technician's time. Ava is free at 10:45; Zoe
  // holds bk_5104 (10:30–11:15, checked in) → moving Ava's 10:45 to Zoe is a 409 (it was unchecked, the refusal swallowed);
  // an authorised override writes it FLAGGED; a stale expectedVersion is refused; skills are never overridable (R2).
  const sA = svc(); const avaAppt = await sA.create(owner(), { technicianId: 'tech_ava', customerName: 'Busy Hour', serviceIds: ['svc_mani'], date: TODAY, startTime: '10:45' } as any);
  await throwsP('assign onto a technician busy at that time is a conflict (409)', () => sA.assignTechnician(owner(), avaAppt.appointmentId, { technicianId: 'tech_zoe' }), ConflictError);
  ok('refused assign left the technician unchanged', (await sA.detail(owner(), avaAppt.appointmentId)).technicianId === 'tech_ava');
  await throwsP('assign override without pos.booking.override_conflict is refused (R1)', () => sA.assignTechnician(owner({ permissions: PERMS.filter((x) => x !== 'pos.booking.override_conflict') }), avaAppt.appointmentId, { technicianId: 'tech_zoe', managerOverride: true }), ForbiddenError);
  // under the default BLOCK policy even an authorised override cannot double-book (spec §11; the WARN / ALLOW_AUTHORIZED_ROLE
  // flagged path for assign is pinned in booking-overbooking-policy.vitest.spec.ts) — the override itself is honoured + audited
  await throwsP('assign override under BLOCK stays a 409', () => sA.assignTechnician(owner(), avaAppt.appointmentId, { technicianId: 'tech_zoe', managerOverride: true, overbookReason: 'VIP requested Zoe' }), ConflictError);
  ok('the honoured override is audited', sA.auditLog().some((l) => l.actionType === 'manager_override_used'));
  // version check on a clear reassign: Ava's 17:00 → Zoe (free then); a stale copy is refused, the current one moves + bumps
  const late = await sA.create(owner(), { technicianId: 'tech_ava', customerName: 'Late Guest', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:00' } as any);
  await throwsP('assign with a stale expectedVersion is refused (VERSION_CONFLICT)', () => sA.assignTechnician(owner(), late.appointmentId, { technicianId: 'tech_zoe', expectedVersion: (late.version ?? 1) + 5 }), ConflictError);
  ok('assign with the current version succeeds and bumps it', (await sA.assignTechnician(owner(), late.appointmentId, { technicianId: 'tech_zoe', expectedVersion: late.version })).version === (late.version ?? 1) + 1);
  await throwsP('assign ineligible stays rejected with an override (R2)', () => svc().assignTechnician(owner(), 'bk_5103', { technicianId: 'tech_zoe', managerOverride: true }), ValidationError);
  ok('check-in booked', (await s5.checkIn(owner(), 'bk_5105')).status === 'checked_in');
  await throwsP('check-in needs perm', () => svc().checkIn(owner({ permissions: ['pos.booking.view'] }), 'bk_5101'), ForbiddenError);
  await throwsP('cancel needs reason', () => svc().cancel(owner(), 'bk_5101', { reason: '' }), ValidationError);
  ok('cancel with reason', (await s5.cancel(owner(), 'bk_5101', { reason: 'Customer request' })).status === 'cancelled');
  await throwsP('no-show needs reason', () => svc().noShow(owner(), 'bk_5102', { reason: '' }), ValidationError);
  ok('no-show with reason', (await s5.noShow(owner(), 'bk_5103', { reason: 'Did not arrive' })).status === 'no_show');
  ok('audit: assigned + checked-in + cancelled + no-show', ['pos_booking_appointment_technician_assigned','pos_booking_appointment_checked_in','pos_booking_appointment_cancelled','pos_booking_appointment_no_show'].every((t) => s5.auditLog().some((l) => l.actionType === t)));

  // ---- transfers (idempotent) ----
  const s6 = svc();
  const mq1: any = await s6.moveToQueue(owner(), 'bk_5101');
  ok('move to queue succeeds', mq1.moved === true && mq1.duplicate === false);
  const mq2: any = await s6.moveToQueue(owner(), 'bk_5101');
  ok('move to queue idempotent', mq2.duplicate === true);
  const mt1: any = await s6.moveToTechQueue(owner(), 'bk_5101');
  ok('move to tech queue succeeds', mt1.moved === true && mt1.duplicate === false);
  const mt2: any = await s6.moveToTechQueue(owner(), 'bk_5101');
  ok('move to tech queue idempotent', mt2.duplicate === true);
  const ss1: any = await s6.startService(owner(), 'bk_5101');
  ok('start service succeeds', ss1.moved === true && ss1.duplicate === false);
  ok('booking now in_service', (await s6.detail(owner(), 'bk_5101')).status === 'in_service');
  const ss2: any = await s6.startService(owner(), 'bk_5101');
  ok('start service idempotent', ss2.duplicate === true && ss2.idempotencyKey === ss1.idempotencyKey);
  await throwsP('start service on cancelled rejected', async () => { const x = svc(); await x.cancel(owner(), 'bk_5105', { reason: 'x' }); return x.startService(owner(), 'bk_5105'); }, ValidationError);
  // Phase 15 G: create() now assigns the first available technician ("first available" used to leave it null — which
  // Postgres refuses, technician_id NOT NULL). The tech-queue guard stays as defence in depth: an unassigned row (written
  // straight to the repository) is still refused.
  ok('create without a technician assigns the first available', !!(await svc().create(owner(), { customerName: 'AnyTech', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:45' })).technicianId);
  await throwsP('move to tech queue without tech rejected', async () => { const repo = new InMemoryBookingRepository(); const x = new BookingService(repo); const a = await x.create(owner(), { customerName: 'NoTech', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:45' }); await repo.update(owner() as any, a.appointmentId, { technicianId: null as any }); return x.moveToTechQueue(owner(), a.appointmentId); }, ValidationError);
  await throwsP('move to queue needs queue.create', () => svc().moveToQueue(owner({ permissions: ['pos.booking.view'] }), 'bk_5102'), ForbiddenError);
  await throwsP('start service needs serving.start', () => svc().startService(owner({ permissions: ['pos.booking.view'] }), 'bk_5102'), ForbiddenError);
  ok('audit: queue + tech-queue + serving transfers', ['pos_booking_appointment_moved_to_queue','pos_booking_appointment_moved_to_tech_queue','pos_booking_appointment_started_service'].every((t) => s6.auditLog().some((l) => l.actionType === t)));

  // ---- audit base ----
  ok('audit: viewed tenant-scoped', await (async () => { const x = svc(); await x.getState(owner()); return x.auditLog().some((l) => l.actionType === 'pos_booking_viewed' && l.tenantId === 'luxe001'); })());

  // --- Booking aggregates (T04 KPI feed): walk-ins, booked revenue, minutes, source/service mix ---
  const bagg = computeBookingAggregates([
    { source: 'walk_in', status: 'confirmed', services: [{ serviceName: 'Mani', durationMinutes: 30, priceCents: 3000 }] },
    { source: 'online', status: 'confirmed', services: [{ serviceName: 'Pedi', durationMinutes: 45, priceCents: 5000 }] },
    { source: 'walk_in', status: 'cancelled', services: [{ serviceName: 'Mani', durationMinutes: 30, priceCents: 3000 }] },
  ]);
  ok('bookingAgg: walk-ins counted', bagg.walkInsToday === 2);
  ok('bookingAgg: revenue excludes cancelled', bagg.bookedRevenueCents === 8000);
  ok('bookingAgg: minutes exclude cancelled', bagg.bookedMinutes === 75);
  ok('bookingAgg: sourceCounts sum to rows', bagg.sourceCounts.reduce((a, x) => a + x.count, 0) === 3);
  const bst = await svc().getState(owner(), { date: TODAY });
  ok('state: aggregates present', !!bst.aggregates);
  ok('state: source counts sum to total bookings', !!bst.aggregates && bst.aggregates.sourceCounts.reduce((a, x) => a + x.count, 0) === bst.kpis.totalBookingsToday);
  ok('state: booked revenue non-negative', !!bst.aggregates && bst.aggregates.bookedRevenueCents >= 0);

  console.log(`\nbooking-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' \u2713'));
  if (fail) process.exit(1);
})();
