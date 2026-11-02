// tech-queue-core.spec.ts — Nest-free harness for the (async) Tech Queue service + repository + pure dto helpers.
import { InMemoryTechQueueRepository, TechQueueContext } from './tech-queue.repository';
import { TechQueueService, ForbiddenError, ValidationError } from './tech-queue.service';
import { canAccept, canStart, canMoveToServing, deriveDelayStatus, buildServingIdempotencyKey, workloadMinutes, techQueueSearch, DEFAULT_TQ_SETTINGS } from './tech-queue.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new TechQueueService(new InMemoryTechQueueRepository());
// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the owner fixture holds it explicitly.
const PERMS = ['pos.booking.override_conflict','pos.tech_queue.view','pos.tech_queue.accept','pos.tech_queue.decline','pos.tech_queue.reassign','pos.tech_queue.update_services','pos.tech_queue.update_priority','pos.tech_queue.notify_technician','pos.tech_queue.notify_customer','pos.tech_queue.report_delay','pos.tech_queue.move_to_serving','pos.serving.view','pos.technicians.view','pos.reports.view'];
const owner = (over: Partial<TechQueueContext> = {}): TechQueueContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

// ---- pure helpers (synchronous) ----
ok('canAccept allows assigned', canAccept('assigned').ok && canAccept('waiting_for_acceptance').ok);
ok('canAccept blocks in_service', !canAccept('in_service').ok);
ok('canStart blocks when acceptance required', !canStart({ status: 'assigned', mustAccept: true, allowStartWithoutAcceptance: false, managerOverride: false }).ok);
ok('canStart allows accepted', canStart({ status: 'accepted', mustAccept: true, allowStartWithoutAcceptance: false, managerOverride: false }).ok);
ok('canStart allows override', canStart({ status: 'assigned', mustAccept: true, allowStartWithoutAcceptance: false, managerOverride: true }).ok);
ok('canStart allows when acceptance not required', canStart({ status: 'assigned', mustAccept: false, allowStartWithoutAcceptance: true, managerOverride: false }).ok);
ok('canMoveToServing blocks no services', !canMoveToServing({ status: 'accepted', hasTechnician: true, serviceCount: 0, allowWithoutTech: false, mustAccept: true, allowStartWithoutAcceptance: false, managerOverride: false }).ok);
ok('canMoveToServing requires tech unless allowed', !canMoveToServing({ status: 'accepted', hasTechnician: false, serviceCount: 1, allowWithoutTech: false, mustAccept: true, allowStartWithoutAcceptance: false, managerOverride: false }).ok);
ok('canMoveToServing ok when accepted+tech+services', canMoveToServing({ status: 'accepted', hasTechnician: true, serviceCount: 1, allowWithoutTech: false, mustAccept: true, allowStartWithoutAcceptance: false, managerOverride: false }).ok);
ok('delay none under alert', deriveDelayStatus(8, 10) === 'none');
ok('delay warning over', deriveDelayStatus(15, 10) === 'warning');
ok('delay late further', deriveDelayStatus(28, 10) === 'late');
ok('delay critical way over', deriveDelayStatus(60, 10) === 'critical');
ok('idempotency stable', buildServingIdempotencyKey('tq1') === 'tq1:move_to_serving');
ok('workload sums active', workloadMinutes([{ requestedServices: [{ estimatedDurationMinutes: 45 }], status: 'accepted' }, { requestedServices: [{ estimatedDurationMinutes: 30 }], status: 'cancelled' }]) === 45);
ok('search matches service', techQueueSearch([{ techQueueTicketId: 'a', tenantId: 't', customerName: 'X', source: 'walk_in', requestedServices: [{ serviceId: 's', serviceName: 'Gel Manicure', estimatedDurationMinutes: 30 }], serviceCount: 1, priority: 'normal', status: 'assigned', assignedTechnicianId: 't1', assignedTechnicianName: 'Mia', assignedAt: '', createdAt: '', updatedAt: '' }], 'gel').length === 1);

(async () => {
  // ---- access ----
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.kpis.assignedTickets === 0 && other.tickets.items.length === 0 && other.technicianLanes.length === 0);

  // ---- state + KPIs + lanes ----
  const st = await svc().getState(owner());
  ok('seed has tickets', st.tickets.items.length >= 6);
  ok('kpis: assigned tickets', st.kpis.assignedTickets >= 4);
  ok('kpis: waiting for acceptance', st.kpis.waitingForAcceptance >= 1);
  ok('kpis: ready to start', st.kpis.readyToStart >= 1);
  ok('kpis: delayed', st.kpis.delayedTickets >= 1);
  ok('kpis: available technicians', st.kpis.availableTechnicians >= 1);
  ok('technician lanes present', st.technicianLanes.length === 3 && st.technicianLanes.every((l) => !!l.workingStatus && typeof l.estimatedWorkloadMinutes === 'number'));
  ok('lane carries its tickets + counts', st.technicianLanes.some((l) => l.tickets.length >= 1 && l.activeTicketCount >= 0));
  ok('rows carry status + priority + assigned wait', st.tickets.items.every((t) => !!t.status && !!t.priority && (t.assignedWaitMinutes || 0) >= 0));
  ok('facets present', st.filters.statuses.includes('ready_to_start') && st.filters.sources.includes('walk_in'));
  ok('workflow settings exposed', st.workflowSettings.technicianMustAcceptTicket === true);
  ok('technicians list', (await svc().technicians(owner())).length === 3);

  // ---- filters ----
  ok('filter status=accepted', (await svc().tickets(owner(), { status: 'accepted' })).items.every((t) => t.status === 'accepted'));
  ok('filter source=appointment', (await svc().tickets(owner(), { source: 'appointment' })).items.every((t) => t.source === 'appointment'));
  ok('filter technician', (await svc().tickets(owner(), { technicianId: 'tech_mia' })).items.every((t) => t.assignedTechnicianId === 'tech_mia'));
  ok('search by customer', (await svc().tickets(owner(), { search: 'Grace' })).items.length >= 1);
  const paged = await svc().getState(owner(), { page: 1, pageSize: 2 });
  ok('pagination respected', paged.tickets.items.length === 2 && paged.tickets.pagination.totalPages >= 3);

  // ---- detail ----
  const d = await svc().detail(owner(), 'tq_6001');
  ok('detail has requested services + eligibility', d.requestedServices.length >= 1 && typeof d.technicianEligible === 'boolean');

  // ---- accept / decline ----
  const s2 = svc();
  ok('accept a waiting ticket', ['accepted', 'ready_to_start'].includes((await s2.accept(owner(), 'tq_6001')).status));
  await throwsAsync('cannot accept in-service', () => svc().accept(owner(), 'tq_6006'), ValidationError);
  await throwsAsync('accept needs perm', () => svc().accept(owner({ permissions: ['pos.tech_queue.view'] }), 'tq_6005'), ForbiddenError);
  await throwsAsync('decline needs reason', () => svc().decline(owner(), 'tq_6005', { reason: '' }), ValidationError);
  ok('decline with reason', (await s2.decline(owner(), 'tq_6005', { reason: 'Not my specialty' })).status === 'declined');
  ok('audit: accepted + declined', s2.auditLog().some((l) => l.actionType === 'pos_tech_queue_ticket_accepted') && s2.auditLog().some((l) => l.actionType === 'pos_tech_queue_ticket_declined'));

  // ---- ownership (technician can only act on own ticket) ----
  const techCtx = (techUserId: string): TechQueueContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: techUserId, role: 'TECHNICIAN', permissions: ['pos.tech_queue.view','pos.tech_queue.accept','pos.tech_queue.move_to_serving','pos.serving.view'] });
  await throwsAsync('technician cannot accept another tech ticket', () => svc().accept(techCtx('tech_ava'), 'tq_6001'), ForbiddenError);
  ok('technician can accept own ticket', ['accepted', 'ready_to_start'].includes((await svc().accept(techCtx('tech_mia'), 'tq_6001')).status));

  // ---- reassign (eligibility) ----
  const r3 = new InMemoryTechQueueRepository(); const s3 = new TechQueueService(r3);
  ok('reassign to eligible available tech', (await s3.reassign(owner(), 'tq_6003', { technicianId: 'tech_mia', reason: 'Balancing load' })).assignedTechnicianName === 'Mia');
  // developer merge (Oct 6 2026): the receiving technician gets an in-app feed row (type 'assignment', reference = the ticket)
  ok('reassign writes the receiving technician\'s in-app notification', r3.techNotifications.length === 1 && r3.techNotifications[0].technicianId === 'tech_mia' && r3.techNotifications[0].type === 'assignment' && r3.techNotifications[0].reference === 'tq_6003');
  await throwsAsync('reassign requires reason', () => svc().reassign(owner(), 'tq_6003', { technicianId: 'tech_ava' } as any), ValidationError);
  await throwsAsync('reassign to unavailable blocked', () => svc().reassign(owner(), 'tq_6003', { technicianId: 'tech_ava', reason: 'x' }), ValidationError);
  await throwsAsync('override without pos.booking.override_conflict is Forbidden (R1)', () => svc().reassign(owner({ permissions: PERMS.filter((p) => p !== 'pos.booking.override_conflict') }), 'tq_6003', { technicianId: 'tech_ava', reason: 'x', managerOverride: true }), ForbiddenError);
  ok('reassign to unavailable allowed with override (holder of pos.booking.override_conflict)', (await s3.reassign(owner(), 'tq_6003', { technicianId: 'tech_ava', reason: 'x', managerOverride: true })).assignedTechnicianName === 'Ava');
  ok('audit: the honoured override', s3.auditLog().some((l) => l.actionType === 'manager_override_used'));
  // R2: the override bypasses availability ONLY — tq_6002 is a Pedicure, which Mia does not hold
  await throwsAsync('override never bypasses skills (R2)', () => svc().reassign(owner(), 'tq_6002', { technicianId: 'tech_mia', reason: 'x', managerOverride: true }), ValidationError);
  // decline is guarded: only a pending offer flips, the reason lands on the notes, a stale version is refused
  const sD = svc(); const declined = await sD.decline(owner(), 'tq_6005', { reason: 'Double-booked' } as any);
  ok('decline keeps the reason on the ticket notes', declined.status === 'declined' && String((declined as any).notes || '').includes('(declined) Double-booked'));
  await throwsAsync('declining a ticket that is no longer a pending offer is refused', () => sD.decline(owner(), 'tq_6005', { reason: 'again' } as any), ValidationError);
  await throwsAsync('declining with a stale expectedVersion is a refused no-op', () => svc().decline(owner(), 'tq_6005', { reason: 'x', expectedVersion: 99 } as any), ValidationError);
  ok('audit: reassigned', s3.auditLog().some((l) => l.actionType === 'pos_tech_queue_technician_reassigned'));

  // ---- services / priority ----
  const s4 = svc();
  ok('update services', (await s4.updateServices(owner(), 'tq_6001', { serviceIds: ['svc_mani', 'svc_gel'] })).requestedServices.length === 2);
  await throwsAsync('update services unknown rejected', () => svc().updateServices(owner(), 'tq_6001', { serviceIds: ['nope'] }), ValidationError);
  ok('update priority', (await s4.updatePriority(owner(), 'tq_6002', { priority: 'urgent' })).priority === 'urgent');
  await throwsAsync('priority needs perm', () => svc().updatePriority(owner({ permissions: ['pos.tech_queue.view'] }), 'tq_6002', { priority: 'high' }), ForbiddenError);
  ok('audit: services + priority', s4.auditLog().some((l) => l.actionType === 'pos_tech_queue_services_updated') && s4.auditLog().some((l) => l.actionType === 'pos_tech_queue_priority_updated'));

  // ---- notifications (honest) ----
  const s5 = svc();
  const nt = await s5.notifyTechnician(owner(), 'tq_6001', { channel: 'push' });
  ok('notify technician not configured (honest)', nt.configured === false && /not configured/i.test(nt.disabledReason!));
  const ncSms = await s5.notifyCustomer(owner(), 'tq_6001', { channel: 'sms' });
  ok('notify customer sms not configured (honest)', ncSms.configured === false);
  const ncFd = await s5.notifyCustomer(owner(), 'tq_6001', { channel: 'front_desk' });
  ok('notify customer front-desk works', ncFd.configured === true);
  ok('audit: tech + customer notified', s5.auditLog().some((l) => l.actionType === 'pos_tech_queue_technician_notified') && s5.auditLog().some((l) => l.actionType === 'pos_tech_queue_customer_notified'));

  // ---- delay ----
  const s6 = svc();
  await throwsAsync('report delay needs reason', () => svc().reportDelay(owner(), 'tq_6002', { reason: '' }), ValidationError);
  ok('report delay sets delayed', (await s6.reportDelay(owner(), 'tq_6002', { reason: 'Add-on requested', extraMinutes: 15 })).status === 'delayed');
  ok('delay severity from extra minutes', (await s6.detail(owner(), 'tq_6002')).delayStatus === 'late');
  await throwsAsync('clear delay needs note', () => svc().clearDelay(owner(), 'tq_6004', { note: '' }), ValidationError);
  ok('clear delay resets', (await s6.clearDelay(owner(), 'tq_6002', { note: 'Resolved' })).delayStatus === 'none');
  ok('audit: delay reported + cleared', s6.auditLog().some((l) => l.actionType === 'pos_tech_queue_delay_reported') && s6.auditLog().some((l) => l.actionType === 'pos_tech_queue_delay_cleared'));

  // ---- start service / move to serving (idempotent, acceptance-gated) ----
  const s7 = svc();
  await throwsAsync('move to serving blocked before acceptance (mustAccept)', () => svc().moveToServing(owner(), 'tq_6005'), ValidationError);
  const ms1: any = await s7.moveToServing(owner(), 'tq_6003');
  ok('move to serving succeeds when ready', ms1.moved === true && ms1.duplicate === false);
  ok('ticket now in_service', (await s7.tickets(owner(), { status: 'in_service' })).items.some((t) => t.techQueueTicketId === 'tq_6003'));
  const ms2: any = await s7.moveToServing(owner(), 'tq_6003');
  ok('move to serving idempotent', ms2.duplicate === true && ms2.idempotencyKey === ms1.idempotencyKey);
  await throwsAsync('move to serving override without pos.booking.override_conflict is Forbidden (R1)', () => svc().moveToServing(owner({ permissions: PERMS.filter((p) => p !== 'pos.booking.override_conflict') }), 'tq_6005', true), ForbiddenError);
  ok('move to serving with override before acceptance', ((await svc().moveToServing(owner(), 'tq_6005', true)) as any).moved === true);
  await throwsAsync('move to serving needs serving.view too', () => svc().moveToServing(owner({ permissions: ['pos.tech_queue.view','pos.tech_queue.move_to_serving'] }), 'tq_6003'), ForbiddenError);
  ok('audit: started + moved to serving', s7.auditLog().some((l) => l.actionType === 'pos_tech_queue_started_service') && s7.auditLog().some((l) => l.actionType === 'pos_tech_queue_moved_to_serving' && l.entityType === 'pos_serving_transfer'));

  // ---- allowStartWithoutAcceptance variant ----
  const looseRepo = new InMemoryTechQueueRepository();
  (looseRepo as any).settings = () => ({ ...DEFAULT_TQ_SETTINGS, allowStartWithoutAcceptance: true });
  const sLoose = new TechQueueService(looseRepo);
  ok('move to serving without acceptance when allowed', ((await sLoose.moveToServing(owner(), 'tq_6005')) as any).moved === true);

  // ---- cancel ----
  const s8 = svc();
  await throwsAsync('cancel needs reason', () => svc().cancel(owner(), 'tq_6001', { reason: '' }), ValidationError);
  ok('cancel sets cancelled', (await s8.cancel(owner(), 'tq_6001', { reason: 'Customer left' })).status === 'cancelled');
  await throwsAsync('cancel needs supervisory perm', () => svc().cancel(owner({ permissions: ['pos.tech_queue.view'] }), 'tq_6002', { reason: 'x' }), ForbiddenError);
  ok('audit: cancelled', s8.auditLog().some((l) => l.actionType === 'pos_tech_queue_cancelled'));

  // ---- audit base ----
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_tech_queue_viewed' && l.tenantId === 'luxe001'));

  console.log(`\ntech-queue-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
