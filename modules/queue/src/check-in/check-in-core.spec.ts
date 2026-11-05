// check-in-core.spec.ts — Nest-free harness for the (async) Check-In service + repository + pure dto helpers.
import { InMemoryCheckInRepository, CheckInContext } from './check-in.repository';
import { CheckInService, ForbiddenError, ValidationError, DuplicateCustomerError } from './check-in.service';
import { findDuplicateCustomer, normalizePhone, canStartFromCheckIn, buildServingIdempotencyKey, checkInDurationMinutes, checkInSearch, mapToCheckInState, computeCheckInAggregates, computeCustomerMix, computeFrontDeskInsights } from './check-in.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n, '(got', (e as Error).name + ')'); } else pass++; }
};

const svc = () => new CheckInService(new InMemoryCheckInRepository());
// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the owner fixture holds it explicitly.
const PERMS = ['pos.booking.override_conflict','pos.check_in.view','pos.check_in.create','pos.check_in.edit','pos.check_in.cancel','pos.check_in.walk_in','pos.check_in.appointment','pos.check_in.create_customer','pos.check_in.assign_technician','pos.check_in.move_to_queue','pos.check_in.move_to_tech_queue','pos.check_in.start_service','pos.customers.view','pos.customers.create','pos.queue.create','pos.tech_queue.create','pos.serving.start'];
const owner = (over: Partial<CheckInContext> = {}): CheckInContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

// ---- pure helpers (synchronous) ----
ok('normalizePhone strips non-digits', normalizePhone('+1 (856) 555-0101') === '18565550101');
ok('findDuplicateCustomer by phone', findDuplicateCustomer([{ customerId: 'c1', phone: '+18565550101' }], '856-555-0101') === 'c1');
ok('findDuplicateCustomer by email', findDuplicateCustomer([{ customerId: 'c1', email: 'A@x.com' }], undefined, 'a@x.com') === 'c1');
ok('findDuplicateCustomer none', findDuplicateCustomer([{ customerId: 'c1', phone: '111' }], '222') === null);
ok('canStartFromCheckIn blocks in_service', !canStartFromCheckIn('in_service').ok && canStartFromCheckIn('checked_in').ok);
ok('idempotency stable', buildServingIdempotencyKey('ci1') === 'ci1:start_service');
ok('duration sums', checkInDurationMinutes([{ durationMinutes: 45 }, { durationMinutes: 15 }]) === 60);
ok('search matches service', checkInSearch([{ checkInId: 'a', tenantId: 't', customerName: 'X', source: 'walk_in', services: [{ serviceId: 's', serviceName: 'Gel Manicure', durationMinutes: 30 }], checkedInAt: '', status: 'checked_in' }], 'gel').length === 1);

(async () => {
  // ---- access ----
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.recentCheckIns.items.length === 0 && other.appointmentsReadyForCheckIn.length === 0 && other.kpis.checkedInToday === 0);

  // ---- state + KPIs ----
  const st = await svc().getState(owner());
  ok('seed has recent check-ins', st.recentCheckIns.items.length >= 4);
  ok('appointments ready present', st.appointmentsReadyForCheckIn.length >= 3 && st.appointmentsReadyForCheckIn.every((a) => a.alreadyCheckedIn === false));
  ok('kpis: checked in today', st.kpis.checkedInToday >= 4);
  ok('kpis: walk-ins + appointments', st.kpis.walkInsCheckedIn >= 1 && st.kpis.appointmentsCheckedIn >= 1);
  ok('kpis: sent to queue + in service', st.kpis.sentToQueue >= 1 && st.kpis.startedService >= 1);
  ok('kpis: online arrivals', st.kpis.onlineArrivalsToday >= 1);
  ok('rows carry source + status', st.recentCheckIns.items.every((r) => !!r.source && !!r.status));
  ok('facets present', st.filters.statuses.includes('sent_to_queue') && st.filters.sources.includes('walk_in'));
  ok('settings exposed', st.settings.allowWalkIns === true && st.settings.defaultQueueRoute === 'queue');

  // ---- search ----
  ok('customer search by name', (await svc().searchCustomers(owner(), 'Grace')).some((c) => c.customerId === 'cust_grace'));
  ok('customer search by phone', (await svc().searchCustomers(owner(), '5550102')).some((c) => c.customerId === 'cust_nora'));
  ok('customer search empty query → []', (await svc().searchCustomers(owner(), '')).length === 0);
  await throwsAsync('customer search needs customers.view', () => svc().searchCustomers(owner({ permissions: ['pos.check_in.view'] }), 'Grace'), ForbiddenError);
  ok('appointment search by name', (await svc().searchAppointments(owner(), 'Grace')).some((a) => a.appointmentId === 'appt_5001'));
  const w = await svc().waitEstimate(owner(), ['svc_mani']);
  ok('wait estimate configured', w.configured === true && (w.quotedWaitMinutes || 0) >= 0);

  // ---- create customer (dup prevention) ----
  const s2 = svc();
  await throwsAsync('create customer requires name', () => svc().createCustomer(owner(), { fullName: '' } as any), ValidationError);
  await throwsAsync('create customer requires phone (settings)', () => svc().createCustomer(owner(), { fullName: 'No Phone' } as any), ValidationError);
  await throwsAsync('create customer duplicate phone rejected', () => svc().createCustomer(owner(), { fullName: 'Dupe', phone: '856-555-0101' } as any), DuplicateCustomerError);
  ok('create new customer', !!(await s2.createCustomer(owner(), { fullName: 'Tess Vu', phone: '+18565559999' })).customerId);
  ok('audit: customer created', s2.auditLog().some((l) => l.actionType === 'pos_check_in_customer_created'));

  // ---- walk-in ----
  const s3 = svc();
  await throwsAsync('walk-in requires name', () => svc().walkIn(owner(), { customerName: '', serviceIds: ['svc_mani'] } as any), ValidationError);
  await throwsAsync('walk-in requires service', () => svc().walkIn(owner(), { customerName: 'X', serviceIds: [] } as any), ValidationError);
  await throwsAsync('walk-in unknown service rejected', () => svc().walkIn(owner(), { customerName: 'X', serviceIds: ['nope'] } as any), ValidationError);
  // Oct 2026 (migration 503's rule, taken into this branch): one active check-in per customer — Liv's seeded walk-in
  // (ci_6001) is still open, so a second one is refused; Nora's only check-in was cancelled, so she can walk in.
  await throwsAsync('walk-in for a customer who is already checked in is refused', () => svc().walkIn(owner(), { customerName: 'Liv Chen', customerPhone: '+18565550103', serviceIds: ['svc_mani'] } as any), ValidationError);
  const wRet = await s3.walkIn(owner(), { customerName: 'Nora Patel', customerPhone: '+18565550102', serviceIds: ['svc_mani'] });
  ok('walk-in links existing customer by phone', wRet.customerId === 'cust_nora' && wRet.status === 'sent_to_queue');
  await throwsAsync('walk-in marked new but phone exists → duplicate', () => svc().walkIn(owner(), { customerName: 'Liv', customerPhone: '+18565550103', serviceIds: ['svc_mani'], isNewCustomer: true } as any), DuplicateCustomerError);
  const wNew = await s3.walkIn(owner(), { customerName: 'Fresh Face', customerPhone: '+18565558888', serviceIds: ['svc_pedi'], technicianId: 'tech_ava' });
  ok('walk-in creates new customer + assigns tech', !!wNew.customerId && wNew.technicianName === 'Ava');
  await throwsAsync('walk-in needs walk_in perm', () => svc().walkIn(owner({ permissions: ['pos.check_in.view'] }), { customerName: 'X', serviceIds: ['svc_mani'] } as any), ForbiddenError);
  ok('walk-in increments checked-in KPI', (await s3.getState(owner())).kpis.walkInsCheckedIn > st.kpis.walkInsCheckedIn);
  ok('audit: walk-in created', s3.auditLog().some((l) => l.actionType === 'pos_check_in_walk_in_created'));

  // ---- §2: every successful check-in is automatically placed in Customer Queue (exactly one entry) ----
  { const repo = new InMemoryCheckInRepository(); const s = new CheckInService(repo);
    const w = await s.walkIn(owner(), { customerName: 'Queue Me', customerPhone: '+18565557001', serviceIds: ['svc_mani'] });
    ok('§2 walk-in auto-creates exactly one Customer Queue entry', repo.queued.filter((q) => q.checkInId === w.checkInId).length === 1);
    ok('§2 walk-in customer is in Customer Queue (sent_to_queue)', w.status === 'sent_to_queue'); }
  { const repo = new InMemoryCheckInRepository(); const s = new CheckInService(repo); const key = 'idem-w-1';
    const a = await s.walkIn(owner(), { customerName: 'Dbl Click', customerPhone: '+18565557002', serviceIds: ['svc_mani'], idempotencyKey: key } as any);
    const b = await s.walkIn(owner(), { customerName: 'Dbl Click', customerPhone: '+18565557002', serviceIds: ['svc_mani'], idempotencyKey: key } as any);
    ok('§2 double-click walk-in (same idem key) = one check-in', a.checkInId === b.checkInId);
    ok('§2 double-click walk-in = one queue entry (no duplicate)', repo.queued.length === 1); }
  { const repo = new InMemoryCheckInRepository(); const s = new CheckInService(repo);
    const a = await s.appointmentCheckIn(owner(), 'appt_5001'); const b = await s.appointmentCheckIn(owner(), 'appt_5001');
    ok('§2 appointment check-in auto-creates exactly one queue entry (idempotent)', a.checkInId === b.checkInId && repo.queued.filter((q) => q.checkInId === a.checkInId).length === 1); }
  { const repo = new InMemoryCheckInRepository(); const s = new CheckInService(repo);
    const w = await s.walkIn(owner(), { customerName: 'Assign First', customerPhone: '+18565557003', serviceIds: ['svc_mani'] });
    await s.assignTechnician(owner(), w.checkInId, { technicianId: 'tech_mia' });
    ok('§2 assignment alone does NOT start service', (await s.detail(owner(), w.checkInId)).status !== 'in_service');
    await s.startService(owner(), w.checkInId);
    ok('§2 only Start Service moves customer to Serving', (await s.detail(owner(), w.checkInId)).status === 'in_service'); }

  // ---- appointment check-in (idempotent) ----
  const s4 = svc();
  const ac1 = await s4.appointmentCheckIn(owner(), 'appt_5001');
  ok('appointment check-in creates record', ac1.status === 'sent_to_queue' && ac1.appointmentId === 'appt_5001' && ac1.services.length >= 1);
  const ac2 = await s4.appointmentCheckIn(owner(), 'appt_5001');
  ok('appointment check-in idempotent (same record)', ac2.checkInId === ac1.checkInId);
  ok('appointment now marked ready=false', !(await s4.appointmentsReady(owner())).some((a) => a.appointmentId === 'appt_5001'));
  await throwsAsync('appointment check-in unknown appt rejected', () => svc().appointmentCheckIn(owner(), 'nope'), ValidationError);
  await throwsAsync('appointment check-in needs perm', () => svc().appointmentCheckIn(owner({ permissions: ['pos.check_in.view'] }), 'appt_5002'), ForbiddenError);
  ok('audit: appointment check-in', s4.auditLog().some((l) => l.actionType === 'pos_check_in_appointment_created'));

  // ---- services / technician / wait ----
  const s5 = svc();
  ok('update services recalculates', (await s5.updateServices(owner(), 'ci_6001', { serviceIds: ['svc_mani', 'svc_gel'] })).services.length === 2);
  await throwsAsync('update services unknown rejected', () => svc().updateServices(owner(), 'ci_6001', { serviceIds: ['nope'] }), ValidationError);
  ok('assign eligible technician', (await s5.assignTechnician(owner(), 'ci_6001', { technicianId: 'tech_mia' })).technicianName === 'Mia');
  await throwsAsync('assign unavailable rejected', () => svc().assignTechnician(owner(), 'ci_6001', { technicianId: 'tech_leo' }), ValidationError);
  // R2: the override bypasses ONLY availability — never skills. s5 already added the Gel add-on to ci_6001 (Leo is not skilled
  // for 'Add-on'), so the override case runs on a fresh instance where ci_6001 is Manicure-only and Leo's only blocker is availability.
  ok('assign unavailable allowed with override (availability only)', (await svc().assignTechnician(owner(), 'ci_6001', { technicianId: 'tech_leo', managerOverride: true })).technicianName === 'Leo');
  await throwsAsync('override never bypasses skills (R2)', () => s5.assignTechnician(owner(), 'ci_6001', { technicianId: 'tech_leo', managerOverride: true }), ValidationError);
  await throwsAsync('assign override without pos.booking.override_conflict refused (R1)', () => svc().assignTechnician(owner({ permissions: PERMS.filter((p) => p !== 'pos.booking.override_conflict') }), 'ci_6001', { technicianId: 'tech_leo', managerOverride: true }), ForbiddenError);
  ok('assign for the audit trail (s5)', (await s5.assignTechnician(owner(), 'ci_6001', { technicianId: 'tech_mia' })).technicianName === 'Mia');
  ok('update wait estimate', (await s5.updateWaitEstimate(owner(), 'ci_6001', { quotedWaitMinutes: 25 })).quotedWaitMinutes === 25);
  ok('audit: services + technician + wait', ['pos_check_in_services_updated','pos_check_in_technician_assigned','pos_check_in_wait_estimate_updated'].every((t) => s5.auditLog().some((l) => l.actionType === t)));

  // ---- transfers (idempotent) ----
  const s6 = svc();
  const mq1: any = await s6.moveToQueue(owner(), 'ci_6001');
  ok('move to queue succeeds', mq1.moved === true && mq1.duplicate === false);
  ok('status now sent_to_queue', (await s6.detail(owner(), 'ci_6001')).status === 'sent_to_queue');
  const mq2: any = await s6.moveToQueue(owner(), 'ci_6001');
  ok('move to queue idempotent', mq2.duplicate === true);
  await throwsAsync('move to tech queue without tech rejected', () => svc().moveToTechQueue(owner(), 'ci_6001'), ValidationError);
  const s6b = svc(); await s6b.assignTechnician(owner(), 'ci_6001', { technicianId: 'tech_mia' });
  const mt1: any = await s6b.moveToTechQueue(owner(), 'ci_6001');
  ok('move to tech queue succeeds with tech', mt1.moved === true && mt1.duplicate === false);
  const mt2: any = await s6b.moveToTechQueue(owner(), 'ci_6001');
  ok('move to tech queue idempotent', mt2.duplicate === true);
  const ss1: any = await s6.startService(owner(), 'ci_6002');
  ok('start service succeeds', ss1.moved === true && ss1.duplicate === false);
  ok('status now in_service', (await s6.detail(owner(), 'ci_6002')).status === 'in_service');
  const ss2: any = await s6.startService(owner(), 'ci_6002');
  ok('start service idempotent', ss2.duplicate === true && ss2.idempotencyKey === ss1.idempotencyKey);
  await throwsAsync('start service on cancelled rejected', () => svc().startService(owner(), 'ci_6004'), ValidationError);
  await throwsAsync('move to queue needs queue.create', () => svc().moveToQueue(owner({ permissions: ['pos.check_in.view','pos.check_in.move_to_queue'] }), 'ci_6001'), ForbiddenError);
  await throwsAsync('start service needs serving.start', () => svc().startService(owner({ permissions: ['pos.check_in.view','pos.check_in.start_service'] }), 'ci_6002'), ForbiddenError);
  ok('audit: queue + tech-queue + serving transfers', ['pos_check_in_moved_to_queue','pos_check_in_started_service'].every((t) => s6.auditLog().some((l) => l.actionType === t)) && s6b.auditLog().some((l) => l.actionType === 'pos_check_in_moved_to_tech_queue'));

  // ---- cancel ----
  const s7 = svc();
  await throwsAsync('cancel needs reason', () => svc().cancel(owner(), 'ci_6001', { reason: '' }), ValidationError);
  ok('cancel sets cancelled', (await s7.cancel(owner(), 'ci_6001', { reason: 'Customer left' })).status === 'cancelled');
  ok('cancelled stays in recent (history)', (await s7.getState(owner())).recentCheckIns.items.some((r) => r.checkInId === 'ci_6001' && r.status === 'cancelled'));
  ok('audit: cancelled', s7.auditLog().some((l) => l.actionType === 'pos_check_in_cancelled'));

  // ---- audit base ----
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_check_in_viewed' && l.tenantId === 'luxe001'));

  // ---- contract adapter: POSCheckInFullState -> CheckInState (what the POS screen reads) ----
  const sM = svc(); const full = await sM.getState(owner());
  const mapped = mapToCheckInState(full);
  ok('adapter: todayCheckIns <- checkedInToday', mapped.kpis.todayCheckIns === full.kpis.checkedInToday);
  ok('adapter: waitingGuests <- waitingNow', mapped.kpis.waitingGuests === full.kpis.waitingNow);
  ok('adapter: walkInsToday <- walkInsCheckedIn', mapped.kpis.walkInsToday === full.kpis.walkInsCheckedIn);
  ok('adapter: noShows <- noShowsToday', mapped.kpis.noShows === full.kpis.noShowsToday);
  ok('adapter: readyForTech <- sentToTechQueue', mapped.kpis.readyForTech === full.kpis.sentToTechQueue);
  // Developer tree (Sep 28): the Arrivals panel lists only ACTIVE check-ins — cancelled / completed ones drop off it.
  ok('adapter: arrivals = the active recent check-ins', mapped.arrivals.length === full.recentCheckIns.items.filter((r: any) => !['cancelled', 'completed', 'service_done'].includes(r.status)).length && mapped.arrivals.length > 0);
  ok('adapter: arrivals carry rowId + name', mapped.arrivals.every((a) => !!a.rowId && typeof a.customerName === 'string'));
  ok('adapter: appointment lanes are arrays', Array.isArray(mapped.appointmentCheckIn.upcoming) && Array.isArray(mapped.appointmentCheckIn.arrived) && Array.isArray(mapped.appointmentCheckIn.noShow));
  ok('adapter: services + technicians options mapped', Array.isArray(mapped.services) && Array.isArray(mapped.technicians));
  ok('adapter: availableTechnicians one per tech', Array.isArray(mapped.availableTechnicians) && (mapped.availableTechnicians || []).length === full.filters.technicians.length);
  ok('adapter: techsAvailable counts idle techs', mapped.kpis.techsAvailable === (mapped.availableTechnicians || []).filter((t) => t.status === 'available').length);
  ok('adapter: tech load non-negative + valid status', (mapped.availableTechnicians || []).every((t) => t.activeAssignments >= 0 && (t.status === 'available' || t.status === 'busy')));
  ok('adapter: aggregates present on full state', !!full.aggregates && Array.isArray(full.aggregates.technicianLoad));
  ok('adapter: sourceMix present + pct in range', Array.isArray(mapped.sourceMix) && (mapped.sourceMix || []).every((x) => x.pct >= 0 && x.pct <= 100));
  ok('adapter: arrivalTrend present', Array.isArray(mapped.arrivalTrend));
  ok('aggregates cover FULL set (source counts sum == checkedInToday)', full.aggregates!.sourceCounts.reduce((a, x) => a + x.count, 0) === full.kpis.checkedInToday);
  const aggT = computeCheckInAggregates([{ status: 'in_service', technicianId: 't1', source: 'walk_in', checkedInAtMs: Date.now() }, { status: 'checked_in', technicianId: null, source: 'appointment', checkedInAtMs: Date.now() }]);
  ok('computeCheckInAggregates: active load only', aggT.technicianLoad.find((x) => x.technicianId === 't1')?.activeAssignments === 1);
  ok('computeCheckInAggregates: source counts sum', aggT.sourceCounts.reduce((a, x) => a + x.count, 0) === 2);
  const cmix = computeCustomerMix([{ customerId: 'a', isVip: false }, { customerId: 'b', isVip: false }, { customerId: 'c', isVip: true }], { a: 5, b: 0 });
  ok('computeCustomerMix: returning/new/vip split', cmix.returning === 1 && cmix.new === 1 && cmix.vip === 1 && cmix.total === 3);
  ok('adapter: customerMix total == checkedInToday', !!full.customerMix && full.customerMix.total === full.kpis.checkedInToday);
  ok('adapter: customerType returnRate matches kpi', !!mapped.customerType && mapped.kpis.customerReturnRate === mapped.customerType.returnRatePct);
  ok('adapter: customerType buckets sum to total', !!mapped.customerType && (mapped.customerType.returning + mapped.customerType.new + mapped.customerType.vip) === full.customerMix!.total);
  const fdi = computeFrontDeskInsights({ arrivalByHour: [{ hour: 13, count: 5 }, { hour: 14, count: 2 }], vip: 2, averageWaitMinutes: 25, waitingNow: 3, techsAvailable: 0, walkInsToday: 6, checkedInToday: 10 });
  ok('insights: peak window derived', fdi.some((x) => x.id === 'peak'));
  ok('insights: high wait warns', fdi.some((x) => x.id === 'wait' && x.severity === 'warn'));
  ok('insights: no idle techs warns', fdi.some((x) => x.id === 'noidle' && x.severity === 'warn'));
  ok('insights: vip note present', fdi.some((x) => x.id === 'vip'));
  ok('adapter: frontDeskInsights is array', Array.isArray(mapped.frontDeskInsights));
  ok('adapter: dailyPerformance completed == checkedInToday', !!mapped.dailyPerformance && mapped.dailyPerformance.checkInsCompleted === full.kpis.checkedInToday);
  ok('adapter: dailyPerformance marks missing metrics null', !!mapped.dailyPerformance && mapped.dailyPerformance.avgCheckInSeconds === null && mapped.dailyPerformance.satisfaction === null);

  console.log(`\ncheck-in-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
