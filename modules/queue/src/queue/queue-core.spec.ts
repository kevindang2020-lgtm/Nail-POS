// queue-core.spec.ts — Nest-free harness for the (async) Queue service + repository + pure dto helpers.
import { InMemoryQueueRepository, QueueContext } from './queue.repository';
import { QueueService, ForbiddenError, ValidationError } from './queue.service';
import { estimateWaitMinutes, rankQueue, canMoveToServing, canMoveToTechQueue, buildServingIdempotencyKey, queueSearch, DEFAULT_QUEUE_SETTINGS } from './queue.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new QueueService(new InMemoryQueueRepository());
// Merge Oct 12 2026 (R1): `managerOverride` is honoured only with pos.booking.override_conflict — the fixture holds it explicitly.
const PERMS = ['pos.booking.override_conflict','pos.queue.view','pos.queue.create','pos.queue.edit','pos.queue.call_next','pos.queue.assign_technician','pos.queue.update_priority','pos.queue.move_to_tech_queue','pos.queue.move_to_serving','pos.queue.cancel','pos.queue.remove','pos.serving.view','pos.technicians.view','pos.reports.view'];
const owner = (over: Partial<QueueContext> = {}): QueueContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

// ---- pure helpers (synchronous) ----
ok('estimateWait splits across techs', estimateWaitMinutes(6, 45, 3) === 90);
ok('estimateWait no techs = serial', estimateWaitMinutes(2, 45, 0) === 90);
const ranked = rankQueue([{ queueItemId: 'a', waitedMinutes: 30, priority: 'normal' }, { queueItemId: 'b', waitedMinutes: 5, priority: 'vip' }], true);
ok('rank: vip first when enabled', ranked[0].queueItemId === 'b' && ranked[0].position === 1);
const rankedOff = rankQueue([{ queueItemId: 'a', waitedMinutes: 30, priority: 'normal' }, { queueItemId: 'b', waitedMinutes: 5, priority: 'vip' }], false);
ok('rank: longest wait first when vip disabled', rankedOff[0].queueItemId === 'a');
ok('canMoveToServing blocks no services', !canMoveToServing({ status: 'waiting', hasTechnician: true, serviceCount: 0, allowWithoutTech: false }).ok);
ok('canMoveToServing requires tech unless allowed', !canMoveToServing({ status: 'waiting', hasTechnician: false, serviceCount: 1, allowWithoutTech: false }).ok && canMoveToServing({ status: 'waiting', hasTechnician: false, serviceCount: 1, allowWithoutTech: true }).ok);
ok('canMoveToServing blocks already in service', !canMoveToServing({ status: 'in_service', hasTechnician: true, serviceCount: 1, allowWithoutTech: false }).ok);
ok('canMoveToTechQueue requires tech', !canMoveToTechQueue('waiting', false).ok && canMoveToTechQueue('waiting', true).ok);
ok('idempotency stable', buildServingIdempotencyKey('q1') === 'q1:move_to_serving');
ok('queueSearch matches service', queueSearch([{ queueItemId: 'a', tenantId: 't', customerName: 'X', source: 'walk_in', requestedServices: [{ serviceId: 's', serviceName: 'Gel Manicure', estimatedDurationMinutes: 30 }], serviceCount: 1, priority: 'normal', status: 'waiting', checkedInAt: '', createdAt: '', updatedAt: '' }], 'gel').length === 1);

(async () => {
  // ---- access ----
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.kpis.waitingGuests === 0 && other.queue.items.length === 0);

  // ---- state + KPIs ----
  const st = await svc().getState(owner());
  ok('seed has queue items', st.queue.items.length >= 6);
  ok('kpis: waiting guests', st.kpis.waitingGuests >= 4);
  ok('kpis: vip waiting', st.kpis.vipWaiting >= 1);
  ok('kpis: appointments + walk-ins', st.kpis.appointmentsWaiting >= 1 && st.kpis.walkInsWaiting >= 1);
  ok('kpis: longest wait > 0', st.kpis.longestWaitMinutes > 0);
  ok('kpis: ready for tech', st.kpis.readyForTech >= 1);
  ok('rows carry source + priority + status + quoted wait', st.queue.items.every((q) => !!q.source && !!q.priority && !!q.status && q.quotedWaitMinutes! >= 0));
  ok('rows compute actual wait from server time', st.queue.items.some((q) => (q.actualWaitMinutes || 0) > 0));
  ok('facets present', st.filters.sources.includes('walk_in') && st.filters.priorityLevels.includes('vip'));
  ok('workflow settings exposed', st.workflowSettings.vipPriorityEnabled === true);

  // ---- wait estimate ----
  const we = await svc().waitEstimate(owner());
  ok('wait estimate configured', we.configured === true && we.quotedWaitMinutes! >= 0);

  // ---- filters ----
  ok('filter status=waiting', (await svc().items(owner(), { status: 'waiting' })).items.every((q) => q.status === 'waiting'));
  ok('filter source=appointment', (await svc().items(owner(), { source: 'appointment' })).items.every((q) => q.source === 'appointment'));
  ok('filter priority=vip', (await svc().items(owner(), { priority: 'vip' })).items.every((q) => q.priority === 'vip'));
  ok('search by customer', (await svc().items(owner(), { search: 'Grace' })).items.length >= 1);
  const paged = await svc().getState(owner(), { page: 1, pageSize: 2 });
  ok('pagination respected', paged.queue.items.length === 2 && paged.queue.pagination.totalPages >= 3);

  // ---- detail ----
  const d = await svc().detail(owner(), 'q_5001');
  ok('detail has requested services', d.requestedServices.length >= 1);

  // ---- create / update ----
  const s2 = svc();
  await throwsAsync('create requires name', () => svc().create(owner(), { customerName: '' } as any), ValidationError);
  await throwsAsync('create needs perm', () => svc().create(owner({ permissions: ['pos.queue.view'] }), { customerName: 'Walk In' } as any), ForbiddenError);
  const created = await s2.create(owner(), { customerName: 'Tess Vu', customerPhone: '+18565550150', source: 'walk_in', serviceIds: ['svc_mani'] });
  ok('create returns row', !!created.queueItemId && created.serviceCount === 1);
  ok('create increments waiting', (await s2.getState(owner())).kpis.waitingGuests === st.kpis.waitingGuests + 1);
  ok('audit: created', s2.auditLog().some((l) => l.actionType === 'pos_queue_item_created'));
  ok('update edits notes', (await s2.update(owner(), created.queueItemId, { notes: 'Allergic to acetone' })).notes === 'Allergic to acetone');

  // ---- call next ----
  const s3 = svc();
  ok('call next sets called', (await s3.callNext(owner(), 'q_5001')).status === 'called');
  await throwsAsync('call next needs perm', () => svc().callNext(owner({ permissions: ['pos.queue.view'] }), 'q_5001'), ForbiddenError);
  ok('audit: called next', s3.auditLog().some((l) => l.actionType === 'pos_queue_called_next'));

  // ---- assign / unassign (eligibility) ----
  const s4 = svc();
  ok('assign eligible technician', (await s4.assignTechnician(owner(), 'q_5002', { technicianId: 'tech_ava' })).assignedTechnicianName === 'Ava');
  await throwsAsync('assign unavailable tech blocked', () => svc().assignTechnician(owner(), 'q_5002', { technicianId: 'tech_leo' }), ValidationError);
  ok('assign unavailable tech allowed with override', (await s4.assignTechnician(owner(), 'q_5002', { technicianId: 'tech_leo', managerOverride: true })).assignedTechnicianName === 'Leo');
  await throwsAsync('assign ineligible-skill blocked', () => svc().assignTechnician(owner(), 'q_5004', { technicianId: 'tech_ava' }), ValidationError);
  await throwsAsync('unassign assigned needs reason', () => svc().unassignTechnician(owner(), 'q_5003', {}), ValidationError);
  ok('unassign with reason', (await s4.unassignTechnician(owner(), 'q_5003', { reason: 'Tech went on break' })).assignedTechnicianId == null);
  ok('audit: assigned + unassigned', s4.auditLog().some((l) => l.actionType === 'pos_queue_technician_assigned') && s4.auditLog().some((l) => l.actionType === 'pos_queue_technician_unassigned'));

  // ---- services / priority ----
  const s5 = svc();
  ok('update services', (await s5.updateServices(owner(), 'q_5001', { serviceIds: ['svc_pedi', 'svc_gel'] })).requestedServices.length === 2);
  await throwsAsync('update services unknown rejected', () => svc().updateServices(owner(), 'q_5001', { serviceIds: ['nope'] }), ValidationError);
  ok('update priority', (await s5.updatePriority(owner(), 'q_5002', { priority: 'urgent', reason: 'Customer Queue §23: a raise needs a reason' })).priority === 'urgent');
  await throwsAsync('priority needs perm', () => svc().updatePriority(owner({ permissions: ['pos.queue.view'] }), 'q_5002', { priority: 'high' }), ForbiddenError);
  ok('audit: services + priority', s5.auditLog().some((l) => l.actionType === 'pos_queue_services_updated') && s5.auditLog().some((l) => l.actionType === 'pos_queue_priority_updated'));

  // ---- notify (honest) ----
  const s6 = svc();
  const sms = await s6.notifyCustomer(owner(), 'q_5001', { channel: 'sms' });
  ok('sms notify not configured (honest)', sms.configured === false && /not configured/i.test(sms.disabledReason!));
  const fd = await s6.notifyCustomer(owner(), 'q_5001', { channel: 'front_desk' });
  ok('front-desk notify works', fd.configured === true);
  ok('audit: customer notified', s6.auditLog().some((l) => l.actionType === 'pos_queue_customer_notified'));

  // ---- move to tech queue (idempotent) ----
  const s7 = svc();
  await throwsAsync('move to tech queue requires tech', () => svc().moveToTechQueue(owner(), 'q_5001'), ValidationError);
  const mt1 = await s7.moveToTechQueue(owner(), 'q_5005');
  ok('move to tech queue succeeds', mt1.moved === true && mt1.duplicate === false);
  const mt2 = await s7.moveToTechQueue(owner(), 'q_5005');
  ok('move to tech queue idempotent', mt2.duplicate === true);
  ok('audit: moved to tech queue', s7.auditLog().some((l) => l.actionType === 'pos_queue_moved_to_tech_queue' && l.entityType === 'pos_tech_queue_transfer'));

  // ---- start service / move to serving (idempotent) ----
  const s8 = svc();
  await throwsAsync('move to serving requires tech (default)', () => svc().moveToServing(owner(), 'q_5002'), ValidationError);
  const ms1 = await s8.moveToServing(owner(), 'q_5005');
  ok('move to serving succeeds', ms1.moved === true && ms1.duplicate === false);
  ok('queue item now in_service', (await s8.items(owner(), { status: 'in_service' })).items.some((q) => q.queueItemId === 'q_5005'));
  const ms2 = await s8.moveToServing(owner(), 'q_5005');
  ok('move to serving idempotent', ms2.duplicate === true && ms2.idempotencyKey === ms1.idempotencyKey);
  await throwsAsync('move to serving needs serving.view too', () => svc().moveToServing(owner({ permissions: ['pos.queue.view','pos.queue.move_to_serving'] }), 'q_5005'), ForbiddenError);
  ok('audit: started + moved to serving', s8.auditLog().some((l) => l.actionType === 'pos_queue_started_service') && s8.auditLog().some((l) => l.actionType === 'pos_queue_moved_to_serving' && l.entityType === 'pos_serving_transfer'));

  // ---- allowMoveToServingWithoutTech variant ----
  const noTechRepo = new InMemoryQueueRepository();
  (noTechRepo as any).settings = () => ({ ...DEFAULT_QUEUE_SETTINGS, allowMoveToServingWithoutTech: true });
  const sNoTech = new QueueService(noTechRepo);
  ok('move to serving without tech when allowed', (await sNoTech.moveToServing(owner(), 'q_5002')).moved === true);

  // ---- cancel / remove ----
  const s9 = svc();
  await throwsAsync('cancel needs reason', () => svc().cancel(owner(), 'q_5001', { reason: '' }), ValidationError);
  ok('cancel sets cancelled', (await s9.cancel(owner(), 'q_5001', { reason: 'Customer left' })).status === 'cancelled');
  ok('cancelled stays in roster (reports)', (await s9.getState(owner())).queue.items.some((q) => q.queueItemId === 'q_5001' && q.status === 'cancelled'));
  await throwsAsync('remove needs perm', () => svc().remove(owner({ permissions: ['pos.queue.view'] }), 'q_5002', {}), ForbiddenError);
  ok('remove sets removed', (await s9.remove(owner(), 'q_5002', { reason: 'Duplicate' })).removed === true);
  ok('audit: cancelled + removed', s9.auditLog().some((l) => l.actionType === 'pos_queue_cancelled') && s9.auditLog().some((l) => l.actionType === 'pos_queue_removed'));

  // ---- audit base ----
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_queue_viewed' && l.tenantId === 'luxe001'));

  console.log(`\nqueue-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
