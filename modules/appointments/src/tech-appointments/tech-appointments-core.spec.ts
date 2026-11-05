// tech-appointments-core.spec.ts — Nest-free harness for the (async) Tech Appointments service + repo + pure helpers.
import { InMemoryTechApptRepository, TechApptContext } from './tech-appointments.repository';
import { TechAppointmentsService, ForbiddenError, ValidationError, ConflictError } from './tech-appointments.service';
import { addMinutesToTime, durationOfServices, withinStoreHours, detectTechnicianConflict, detectCustomerOverlap, canCheckIn, canStartService, buildServingIdempotencyKey, techApptSearch } from './tech-appointments.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n, '(got', (e as Error).name + ')'); } else pass++; }
};

const svc = () => new TechAppointmentsService(new InMemoryTechApptRepository());
const PERMS = ['pos.tech_appointments.view','pos.tech_appointments.create','pos.tech_appointments.edit','pos.tech_appointments.reschedule','pos.tech_appointments.cancel','pos.tech_appointments.no_show','pos.tech_appointments.check_in','pos.tech_appointments.assign_technician','pos.tech_appointments.override_conflict','pos.queue.create','pos.tech_queue.create','pos.serving.start','pos.reports.view',
  // Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the owner fixture carries it.
  'pos.booking.override_conflict'];
const owner = (over: Partial<TechApptContext> = {}): TechApptContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });
const TODAY = '2026-06-06';

// ---- pure helpers (synchronous) ----
ok('addMinutesToTime', addMinutesToTime('10:00', 45) === '10:45');
ok('addMinutesToTime crosses hour', addMinutesToTime('10:50', 20) === '11:10');
ok('durationOfServices', durationOfServices([{ durationMinutes: 45 }, { durationMinutes: 15 }]) === 60);
ok('withinStoreHours true', withinStoreHours('10:00', '10:45', '09:00', '19:00'));
ok('withinStoreHours false (after close)', !withinStoreHours('18:45', '19:30', '09:00', '19:00'));
const ex = [{ appointmentId: 'a1', technicianId: 't1', startTime: '10:00', endTime: '10:45', status: 'booked' as const }];
ok('conflict: overlap detected', detectTechnicianConflict(ex, 't1', '10:30', '11:00', 0).status === 'conflict');
ok('conflict: buffer pushes into overlap', detectTechnicianConflict(ex, 't1', '10:50', '11:20', 10).status === 'conflict');
ok('conflict: different tech ok', detectTechnicianConflict(ex, 't2', '10:30', '11:00', 0).status === 'none');
ok('conflict: ignore self', detectTechnicianConflict(ex, 't1', '10:00', '10:45', 0, 'a1').status === 'none');
ok('customer overlap detected', detectCustomerOverlap([{ appointmentId: 'a1', customerId: 'c1', startTime: '10:00', endTime: '10:45', status: 'booked' }], 'c1', '10:30', '11:00'));
ok('customer overlap none for different customer', !detectCustomerOverlap([{ appointmentId: 'a1', customerId: 'c1', startTime: '10:00', endTime: '10:45', status: 'booked' }], 'c2', '10:30', '11:00'));
ok('canCheckIn booked', canCheckIn('booked') && !canCheckIn('in_service'));
ok('canStartService blocks completed', !canStartService('completed').ok && canStartService('checked_in').ok);
ok('idempotency stable', buildServingIdempotencyKey('ta1') === 'ta1:start_service');
ok('search matches service', techApptSearch([{ appointmentId: 'a', tenantId: 't', technicianId: 't1', customerName: 'X', source: 'phone', services: [{ serviceId: 's', serviceName: 'Gel Manicure', durationMinutes: 30 }], startTime: '10:00', endTime: '10:30', durationMinutes: 30, status: 'booked' }], 'gel').length === 1);

(async () => {
  // ---- access ----
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.appointments.length === 0 && other.technicians.length === 0 && other.kpis.totalAppointmentsToday === 0);

  // ---- state + KPIs + technicians (board) ----
  const st = await svc().getState(owner());
  ok('seed has appointments today', st.appointments.length >= 6);
  ok('technician columns present', st.technicians.length === 6 && st.technicians.every((t) => !!t.workingStatus && !!t.displayName));
  ok('technician carries counts + skills', st.technicians.some((t) => t.appointmentCount >= 1 && t.serviceSkillGroups.length >= 1));
  ok('kpis: total today', st.kpis.totalAppointmentsToday >= 6);
  ok('kpis: source breakdown', st.kpis.onlineBookings >= 1 && st.kpis.googleBookings >= 1 && st.kpis.aiBookings >= 1);
  ok('kpis: statuses', st.kpis.inServiceAppointments >= 1 && st.kpis.completedAppointments >= 1 && st.kpis.cancelledAppointments >= 1 && st.kpis.noShowAppointments >= 1);
  ok('appointments carry conflict + deposit status', st.appointments.every((a) => !!a.conflictStatus && !!a.depositStatus));
  ok('facets present', st.filters.statuses.includes('in_service') && st.filters.sources.includes('google'));
  ok('settings exposed', st.settings.slotIntervalMinutes === 15 && st.settings.preventDoubleBooking === true);
  ok('date present', st.date === TODAY);

  // ---- filters ----
  ok('filter status=booked', (await svc().appointments(owner(), { status: 'booked' })).every((a) => a.status === 'booked'));
  ok('filter source=google', (await svc().appointments(owner(), { source: 'google' })).every((a) => a.source === 'google'));
  ok('filter technician', (await svc().appointments(owner(), { technicianId: 'tech_mia' })).every((a) => a.technicianId === 'tech_mia'));
  ok('search by customer', (await svc().appointments(owner(), { search: 'Grace' })).length >= 1);

  // ---- detail ----
  const d = await svc().detail(owner(), 'ta_7001');
  ok('detail has services', d.services.length >= 1 && d.durationMinutes > 0);

  // ---- conflict check endpoint ----
  ok('conflict check finds tech_mia 10:00 overlap', (await svc().checkConflict(owner(), { technicianId: 'tech_mia', startTime: '10:15', endTime: '10:45' })).status === 'conflict');
  ok('conflict check clear slot', (await svc().checkConflict(owner(), { technicianId: 'tech_mia', startTime: '17:00', endTime: '17:30' })).status === 'none');

  // ---- create ----
  const s2 = svc();
  await throwsAsync('create requires customer name', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: '', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsAsync('create requires service', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: 'X', serviceIds: [], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsAsync('create unknown service rejected', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: 'X', serviceIds: ['nope'], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsAsync('create outside store hours rejected', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: 'X', serviceIds: ['svc_mani'], date: TODAY, startTime: '20:00' } as any), ValidationError);
  await throwsAsync('create on ineligible tech rejected', () => svc().create(owner(), { technicianId: 'tech_kim', customerName: 'X', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:00' } as any), ValidationError);
  await throwsAsync('create double-book rejected', () => svc().create(owner(), { technicianId: 'tech_mia', customerName: 'X', serviceIds: ['svc_mani'], date: TODAY, startTime: '10:15' } as any), ConflictError);
  ok('create valid appointment', !!(await s2.create(owner(), { technicianId: 'tech_mia', customerName: 'New Guest', customerPhone: '+1', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:00', source: 'walk_in' })).appointmentId);
  await throwsAsync('create needs perm', () => svc().create(owner({ permissions: ['pos.tech_appointments.view'] }), { technicianId: 'tech_mia', customerName: 'X', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:30' } as any), ForbiddenError);
  await throwsAsync('create override without pos.booking.override_conflict refused (R1)', () => svc().create(owner({ permissions: PERMS.filter((p) => p !== 'pos.booking.override_conflict') }), { technicianId: 'tech_mia', customerName: 'Override Guest', serviceIds: ['svc_mani'], date: TODAY, startTime: '10:15', managerOverride: true } as any), ForbiddenError);
  await throwsAsync('override never bypasses skills (R2)', () => svc().create(owner(), { technicianId: 'tech_kim', customerName: 'X', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:00', managerOverride: true } as any), ValidationError);
  const sOv = svc(); const ovRow = await sOv.create(owner(), { technicianId: 'tech_mia', customerName: 'Override Guest', serviceIds: ['svc_mani'], date: TODAY, startTime: '10:15', managerOverride: true } as any);
  ok('create with override double-book logs conflict_override', sOv.auditLog().some((l) => l.actionType === 'pos_tech_appointment_conflict_override'));
  ok('create with override is written FLAGGED (overbooked) and audited manager_override_used', ovRow.overbooked === true && sOv.auditLog().some((l) => l.actionType === 'manager_override_used'));
  ok('rows carry a version', ovRow.version === 1);
  ok('audit: created', s2.auditLog().some((l) => l.actionType === 'pos_tech_appointment_created'));

  // ---- edit ----
  const s3 = svc();
  const eRes = await s3.update(owner(), 'ta_7005', { serviceIds: ['svc_mani', 'svc_gel'] });
  ok('edit updates services + duration', eRes.services.length === 2 && eRes.durationMinutes === 60);
  ok('audit: updated', s3.auditLog().some((l) => l.actionType === 'pos_tech_appointment_updated'));

  // ---- reschedule ----
  const s4 = svc();
  ok('reschedule to clear slot', (await s4.reschedule(owner(), 'ta_7005', { startTime: '17:30' })).startTime === '17:30');
  await throwsAsync('reschedule into conflict rejected', () => svc().reschedule(owner(), 'ta_7005', { startTime: '10:15', technicianId: 'tech_mia' }), ConflictError);
  await throwsAsync('reschedule outside hours rejected', () => svc().reschedule(owner(), 'ta_7005', { startTime: '20:00' }), ValidationError);
  const sRo = svc(); const moved = await sRo.reschedule(owner(), 'ta_7005', { startTime: '10:15', technicianId: 'tech_mia', managerOverride: true } as any);
  ok('reschedule with override into conflict logs override', sRo.auditLog().some((l) => l.actionType === 'pos_tech_appointment_conflict_override'));
  ok('reschedule with override writes the overbook flag; moving back to a clear slot clears it', moved.overbooked === true && (await sRo.reschedule(owner(), 'ta_7005', { startTime: '17:30' })).overbooked !== true);
  // optimistic concurrency (§14–§16): a stale expectedVersion is refused with code VERSION_CONFLICT, a fresh one is accepted
  const sVer = svc(); const v1 = (await sVer.detail(owner(), 'ta_7005')).version!;
  ok('reschedule with the current version succeeds and bumps it', (await sVer.reschedule(owner(), 'ta_7005', { startTime: '17:30', expectedVersion: v1 })).version === v1 + 1);
  try { await sVer.reschedule(owner(), 'ta_7005', { startTime: '17:00', expectedVersion: v1 }); ok('stale version refused', false); }
  catch (e: any) { ok('stale version refused with VERSION_CONFLICT + currentVersion', e instanceof ConflictError && e.code === 'VERSION_CONFLICT' && e.currentVersion === v1 + 1); }
  ok('stale reschedule left the row untouched', (await sVer.detail(owner(), 'ta_7005')).startTime === '17:30');
  ok('audit: rescheduled', s4.auditLog().some((l) => l.actionType === 'pos_tech_appointment_rescheduled'));

  // ---- assign / check-in / cancel / no-show ----
  const s5 = svc();
  ok('assign eligible technician', (await s5.assignTechnician(owner(), 'ta_7005', { technicianId: 'tech_zoe' })).technicianId === 'tech_zoe');
  await throwsAsync('assign ineligible rejected', () => svc().assignTechnician(owner(), 'ta_7003', { technicianId: 'tech_zoe' }), ValidationError);
  // Ava is free at 10:45; Zoe holds ta_7004 (10:30–11:15, checked in) → reassigning Ava's 10:45 to Zoe is a 409 (was unchecked + swallowed)
  const sA = svc(); const avaAppt = await sA.create(owner(), { technicianId: 'tech_ava', customerName: 'Busy Hour', serviceIds: ['svc_mani'], date: TODAY, startTime: '10:45' } as any);
  await throwsAsync('assign onto a technician busy at that time is a conflict (409)', () => sA.assignTechnician(owner(), avaAppt.appointmentId, { technicianId: 'tech_zoe' }), ConflictError);
  ok('refused assign left the technician unchanged', (await sA.detail(owner(), avaAppt.appointmentId)).technicianId === 'tech_ava');
  ok('assign onto a busy technician with an authorised override is written FLAGGED', (await sA.assignTechnician(owner(), avaAppt.appointmentId, { technicianId: 'tech_zoe', managerOverride: true })).overbooked === true);
  await throwsAsync('assign ineligible stays rejected with an override (R2)', () => svc().assignTechnician(owner(), 'ta_7003', { technicianId: 'tech_zoe', managerOverride: true }), ValidationError);
  ok('check-in a booked appointment', (await s5.checkIn(owner(), 'ta_7005')).status === 'checked_in');
  await throwsAsync('check-in needs perm', () => svc().checkIn(owner({ permissions: ['pos.tech_appointments.view'] }), 'ta_7001'), ForbiddenError);
  await throwsAsync('cancel needs reason', () => svc().cancel(owner(), 'ta_7001', { reason: '' }), ValidationError);
  ok('cancel with reason', (await s5.cancel(owner(), 'ta_7001', { reason: 'Customer request' })).status === 'cancelled');
  ok('no-show sets status', (await s5.noShow(owner(), 'ta_7003')).status === 'no_show');
  ok('audit: assigned + checked-in + cancelled + no-show', ['pos_tech_appointment_technician_assigned','pos_tech_appointment_checked_in','pos_tech_appointment_cancelled','pos_tech_appointment_no_show'].every((t) => s5.auditLog().some((l) => l.actionType === t)));

  // ---- transfers (idempotent) ----
  const s6 = svc();
  const mq1: any = await s6.moveToQueue(owner(), 'ta_7001');
  ok('move to queue succeeds', mq1.moved === true && mq1.duplicate === false);
  const mq2: any = await s6.moveToQueue(owner(), 'ta_7001');
  ok('move to queue idempotent', mq2.duplicate === true);
  const mt1: any = await s6.moveToTechQueue(owner(), 'ta_7001');
  ok('move to tech queue succeeds', mt1.moved === true && mt1.duplicate === false);
  const mt2: any = await s6.moveToTechQueue(owner(), 'ta_7001');
  ok('move to tech queue idempotent', mt2.duplicate === true);
  const ss1: any = await s6.startService(owner(), 'ta_7001');
  ok('start service succeeds', ss1.moved === true && ss1.duplicate === false);
  ok('appointment now in_service', (await s6.detail(owner(), 'ta_7001')).status === 'in_service');
  const ss2: any = await s6.startService(owner(), 'ta_7001');
  ok('start service idempotent', ss2.duplicate === true && ss2.idempotencyKey === ss1.idempotencyKey);
  await throwsAsync('start service on cancelled rejected', async () => { const x = svc(); await x.cancel(owner(), 'ta_7005', { reason: 'x' }); return x.startService(owner(), 'ta_7005'); }, ValidationError);
  await throwsAsync('move to tech queue without tech rejected', async () => { const x = svc(); const a = await x.create(owner(), { technicianId: 'tech_mia', customerName: 'NoTech', serviceIds: ['svc_mani'], date: TODAY, startTime: '17:45' } as any); await (x as any).repo.update(owner(), a.appointmentId, { technicianId: '' }); return x.moveToTechQueue(owner(), a.appointmentId); }, ValidationError);
  await throwsAsync('move to queue needs queue.create perm', () => svc().moveToQueue(owner({ permissions: ['pos.tech_appointments.view'] }), 'ta_7002'), ForbiddenError);
  await throwsAsync('start service needs serving.start perm', () => svc().startService(owner({ permissions: ['pos.tech_appointments.view'] }), 'ta_7002'), ForbiddenError);
  ok('audit: queue + tech-queue + serving transfers', ['pos_tech_appointment_moved_to_queue','pos_tech_appointment_moved_to_tech_queue','pos_tech_appointment_started_service'].every((t) => s6.auditLog().some((l) => l.actionType === t)));

  // ---- audit base ----
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_tech_appointments_viewed' && l.tenantId === 'luxe001'));

  console.log(`\ntech-appointments-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
