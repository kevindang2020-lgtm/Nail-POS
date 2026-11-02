// live-technician-schedule-core.spec.ts — Nest-free harness for the Live Technician Schedule pure helpers + service.
import { InMemoryLiveScheduleRepository, LiveScheduleContext } from './live-technician-schedule.repository';
import { LiveTechnicianScheduleService, ForbiddenError, ValidationError, ConflictError, weekDates } from './live-technician-schedule.service';
import {
  lsMinutesOf, lsToHHMM, lsInitials, lsBookedMinutes, lsShiftMinutes, lsUtilization, lsComputeOpenSlots, lsNormalizeStatus, lsMapApptStatus,
} from './live-technician-schedule.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsP = async (n: string, fn: () => Promise<unknown>, t?: any) => { try { await fn(); fail++; console.error('FAIL (no throw):', n); } catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n, '(got', (e as Error).name + ')'); } else pass++; } };

const svc = () => new LiveTechnicianScheduleService(new InMemoryLiveScheduleRepository());
const PERMS = ['technicians.view', 'technicians.edit', 'booking.manage'];
const owner = (over: Partial<LiveScheduleContext> = {}): LiveScheduleContext => ({ tenantId: 'luxe001', branchId: 'br_main', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });
// Merge Oct 12 2026 (R1): a manager override is a permission-gated act (pos.booking.override_conflict) — the manager fixture holds it.
const manager = (over: Partial<LiveScheduleContext> = {}): LiveScheduleContext => owner({ userId: 'u_manager', role: 'MANAGER' as any, permissions: [...PERMS, 'pos.booking.override_conflict'], ...over });

// ---- pure helpers ----
ok('lsMinutesOf', lsMinutesOf('10:30') === 630);
// week view (merge Oct 12 2026): Monday..Sunday of the week containing the anchor, pure calendar arithmetic
ok('weekDates: a Wednesday anchors to its Monday', weekDates('2026-10-14').join(',') === '2026-10-12,2026-10-13,2026-10-14,2026-10-15,2026-10-16,2026-10-17,2026-10-18');
ok('weekDates: a Sunday belongs to the week that started the previous Monday', weekDates('2026-10-18')[0] === '2026-10-12' && weekDates('2026-10-18')[6] === '2026-10-18');
ok('weekDates: a Monday is its own week start', weekDates('2026-10-12')[0] === '2026-10-12');
ok('lsToHHMM', lsToHHMM(630) === '10:30' && lsToHHMM(75) === '01:15');
ok('lsInitials', lsInitials('Sophia Nguyen') === 'SN' && lsInitials('') === '?');
ok('lsBookedMinutes counts busy only', lsBookedMinutes([{ startTime: '10:00', endTime: '11:00', status: 'in_service' }, { startTime: '11:00', endTime: '12:00', status: 'cancelled' }]) === 60);
ok('lsShiftMinutes minus lunch', lsShiftMinutes({ startTime: '09:00', endTime: '17:00', breakStartTime: '12:00', breakEndTime: '12:30' }) === 450);
ok('lsUtilization clamps', lsUtilization(120, 450) === 27 && lsUtilization(10, 0) === 0 && lsUtilization(500, 100) === 100);
ok('lsMapApptStatus maps booked->confirmed', lsMapApptStatus('booked') === 'confirmed' && lsMapApptStatus('in_service') === 'in_service');
const slots = lsComputeOpenSlots('t1', { startTime: '09:00', endTime: '12:00' }, [{ startTime: '10:00', endTime: '10:30' }], 30);
ok('open slots split around appt', slots.length === 2 && slots[0].startTime === '09:00' && slots[0].endTime === '10:00' && slots[1].startTime === '10:30');
ok('open slots empty when no shift', lsComputeOpenSlots('t1', undefined, [], 30).length === 0);
ok('status: raw on_break wins', lsNormalizeStatus('on_break', true, [], [], 660) === 'on_break');
// Developer tree (Sep 28): a technician who CLOCKED IN (the time clock sets them 'available') is on the floor even with no
// scheduled shift — the live status wins. With no shift and no live status they are off shift.
ok('status: no shift and no live status -> off_shift', lsNormalizeStatus(undefined, false, [], [], 660) === 'off_shift');
// re-pinned (merge Oct 12 2026): a stale presence flag with no shift AND no open punch is Off Shift — the adapter turns an open punch into a shift
ok('status: available flag without any shift today (no schedule, no open punch) -> off_shift', lsNormalizeStatus('available', false, [], [], 660) === 'off_shift');
ok('status: in_service appt', lsNormalizeStatus('available', true, [{ startTime: '10:00', endTime: '11:00', status: 'in_service' }], [], 660) === 'in_service');
ok('status: checked_in -> waiting', lsNormalizeStatus('available', true, [{ startTime: '11:00', endTime: '12:00', status: 'checked_in' }], [], 660) === 'checked_in_waiting');
ok('status: blocked window', lsNormalizeStatus('available', true, [], [{ startTime: '10:00', endTime: '12:00' }], 660) === 'blocked');
ok('status: upcoming assigned', lsNormalizeStatus('available', true, [{ startTime: '14:00', endTime: '15:00', status: 'assigned' }], [], 660) === 'assigned');

(async () => {
  // ---- access ----
  await throwsP('customer blocked', () => svc().pageState(owner({ role: 'CUSTOMER' as any }), {}), ForbiddenError);
  await throwsP('super admin blocked', () => svc().pageState(owner({ role: 'SUPER_ADMIN' as any, permissions: [] }), {}), ForbiddenError);
  await throwsP('missing view perm blocked', () => svc().pageState(owner({ role: 'FRONT_DESK' as any, permissions: [] }), {}), ForbiddenError);
  const wk = await svc().week(owner(), { date: '2026-10-14' } as any);
  ok('week(): seven day boards starting Monday', wk.weekStart === '2026-10-12' && wk.days.length === 7 && wk.days.every((d, i) => d.date === weekDates('2026-10-14')[i] && Array.isArray((d.board as any).technicians)));
  await throwsP('week() needs the view permission', () => svc().week(owner({ role: 'FRONT_DESK' as any, permissions: [] }), {}), ForbiddenError);

  // ---- tenant isolation ----
  const other = await svc().pageState(owner({ tenantId: 'other999' }), {});
  ok('tenant isolation: other tenant empty', other.schedule.technicians.length === 0 && other.kpis.workingToday === 0);

  // ---- page state + KPIs ----
  const ps = await svc().pageState(owner(), {});
  ok('lists all active technicians (incl off-shift)', ps.schedule.technicians.length === 4);
  ok('kpis workingToday = 3', ps.kpis.workingToday === 3);
  ok('kpis inService = 1', ps.kpis.inService === 1);
  ok('kpis onBreakOrLunch = 1', ps.kpis.onBreakOrLunch === 1);
  ok('kpis bookedHours > 0', ps.kpis.bookedHours > 0);
  ok('filters expose statuses + skills + technicians', ps.filters.statuses.length === 10 && ps.filters.skills.length >= 1 && ps.filters.technicians.length === 4);
  ok('context echoes tenant', ps.context.tenantId === 'luxe001');

  const mia = ps.schedule.technicians.find((t) => t.technicianId === 'tech_mia')!;
  ok('mia in_service with 2 appts', mia.status === 'in_service' && mia.appointments.length === 2);
  ok('mia utilization 27%', mia.utilizationPercent === 27);
  ok('mia has open slots', mia.openSlots.length === 4 && mia.openSlots[0].startTime === '09:00');
  ok('mia has active ticket', !!mia.activeTicket);
  const zoe = ps.schedule.technicians.find((t) => t.technicianId === 'tech_zoe')!;
  ok('zoe off_shift, no shift', zoe.status === 'off_shift' && !zoe.shift);

  // ---- filters ----
  const inSvc = await svc().board(owner(), { status: 'in_service' });
  ok('status filter works', inSvc.technicians.length === 1 && inSvc.technicians[0].technicianId === 'tech_mia');
  const waxers = await svc().board(owner(), { skill: 'Waxing' });
  ok('skill filter works', waxers.technicians.every((c) => c.skills.includes('Waxing')) && waxers.technicians.length === 1);

  // ---- detail ----
  const d = await svc().detail(owner({ permissions: [...PERMS, 'technicians.view_pay'] }), 'tech_mia');
  ok('detail: sales + commission preview', d.salesTodayCents === 12000 && d.commissionPreviewCents === 4800);
  // Oct 30 2026: pay is redacted on the server for a role without pay access (null — never a made-up 0)
  const fd = await svc().detail(owner({ role: 'FRONT_DESK' as any, permissions: ['technicians.view'] }), 'tech_mia');
  ok('detail: no pay access → sales / tips / commission null', fd.salesTodayCents === null && fd.tipsTodayCents === null && fd.commissionPreviewCents === null && fd.fullName === d.fullName);
  ok('detail: next appointment is the 13:00', d.nextAppointment?.startTime === '13:00');
  await throwsP('detail unknown tech 404', () => svc().detail(owner(), 'nope'), ValidationError);

  // ---- block time ----
  const s1 = svc();
  const blk = await s1.blockTime(owner(), 'tech_mia', { startTime: '15:00', endTime: '16:00', reason: 'training' });
  ok('block created', !!blk.blockId);
  await throwsP('block bad time rejected', () => svc().blockTime(owner(), 'tech_mia', { startTime: '16:00', endTime: '15:00' }), ValidationError);
  await throwsP('block bad format rejected', () => svc().blockTime(owner(), 'tech_mia', { startTime: '9am', endTime: '10am' }), ValidationError);
  await throwsP('block unknown tech rejected', () => svc().blockTime(owner(), 'nope', { startTime: '15:00', endTime: '16:00' }), ValidationError);
  const after = await s1.board(owner(), {});
  const miaAfter = after.technicians.find((t) => t.technicianId === 'tech_mia')!;
  ok('block reflected on board', miaAfter.blocks.some((b) => b.reason === 'training') && miaAfter.openSlots.length === 5);
  ok('block audited', s1.auditLog().some((l) => l.actionType === 'technician_block_time_created'));

  // ---- break (start/end + guard) ----
  await throwsP('start break blocked while in service', () => svc().startBreak(owner(), 'tech_mia'), ConflictError);
  const s2 = svc();
  await throwsP('override without pos.booking.override_conflict is Forbidden (R1)', () => svc().startBreak(owner(), 'tech_mia', { managerOverride: true }), ForbiddenError);
  const ovr = await s2.startBreak(manager(), 'tech_mia', { managerOverride: true });
  ok('the honoured override is audited', s2.auditLog().some((l) => l.actionType === 'manager_override_used'));
  ok('manager override starts break', ovr.status === 'on_break');
  const s3 = svc();
  await s3.startBreak(owner(), 'tech_ava'); // ava not in service
  const avaBoard = (await s3.board(owner(), {})).technicians.find((t) => t.technicianId === 'tech_ava')!;
  ok('ava now on break', avaBoard.status === 'on_break');
  const s4 = svc();
  const end = await s4.endBreak(owner(), 'tech_leo');
  ok('end break returns available', end.status === 'available');
  const leoBoard = (await s4.board(owner(), {})).technicians.find((t) => t.technicianId === 'tech_leo')!;
  ok('leo no longer on break', leoBoard.status !== 'on_break');
  ok('break audited', s3.auditLog().some((l) => l.actionType === 'technician_break_started') && s4.auditLog().some((l) => l.actionType === 'technician_break_ended'));

  // ---- book open slot ----
  const s5 = svc();
  const board5 = await s5.board(owner(), {});
  const slot = board5.technicians.find((t) => t.technicianId === 'tech_mia')!.openSlots[0];
  const booked = await s5.bookOpenSlot(owner(), slot.slotId, { customerName: 'Walk In', serviceSummary: 'Manicure', durationMinutes: 30 });
  ok('open slot booked', !!booked.appointmentId);
  const miaBooked = (await s5.board(owner(), {})).technicians.find((t) => t.technicianId === 'tech_mia')!;
  ok('booking added an appointment', miaBooked.appointments.length === 3);
  ok('book audited', s5.auditLog().some((l) => l.actionType === 'technician_open_slot_booked'));

  console.log(`\nlive-technician-schedule-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' \u2713'));
  if (fail) process.exit(1);
})();
