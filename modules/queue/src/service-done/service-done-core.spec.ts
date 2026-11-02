// service-done-core.spec.ts — Nest-free harness for the (async) Service Done service + repository + pure dto helpers.
import { InMemoryServiceDoneRepository, ServiceDoneContext } from './service-done.repository';
import { ServiceDoneService, ForbiddenError, ValidationError } from './service-done.service';
import { canSendToCheckout, buildSendIdempotencyKey, subtotalFromLines, DEFAULT_SERVICE_DONE_SETTINGS, serviceDoneSearch } from './service-done.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new ServiceDoneService(new InMemoryServiceDoneRepository());
const PERMS = ['pos.service_done.view','pos.service_done.quality_check','pos.service_done.update_notes','pos.service_done.assign_technician','pos.service_done.send_to_checkout','pos.service_done.notify_customer','pos.service_done.reopen','pos.checkout.view','pos.reports.view'];
const owner = (over: Partial<ServiceDoneContext> = {}): ServiceDoneContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

// ---- pure helpers (synchronous) ----
const S = DEFAULT_SERVICE_DONE_SETTINGS;
ok('canSendToCheckout blocks unapproved quality', !canSendToCheckout({ status: 'completed', qualityStatus: 'pending', settings: S }).ok);
ok('canSendToCheckout allows approved', canSendToCheckout({ status: 'completed', qualityStatus: 'approved', settings: S }).ok);
ok('canSendToCheckout blocks already sent', !canSendToCheckout({ status: 'sent_to_checkout', qualityStatus: 'approved', settings: S }).ok);
ok('canSendToCheckout enforces notes when required', !canSendToCheckout({ status: 'completed', qualityStatus: 'approved', notes: '', settings: { ...S, requireServiceNotes: true } }).ok);
ok('idempotency stable per subtotal', buildSendIdempotencyKey('t1', 7000) === 't1:send_to_checkout:7000');
ok('subtotalFromLines sums', subtotalFromLines([{ priceCents: 5500 }, { priceCents: 1500 }]) === 7000);
ok('serviceDoneSearch matches service name', serviceDoneSearch([{ ticketId: 'a', ticketNumber: '#1', tenantId: 't', customerName: 'X', serviceCount: 1, serviceNames: ['Gel Manicure'], completedAt: '', subtotalCents: 0, qualityStatus: 'pending', checkoutStatus: 'not_ready', status: 'completed' }], 'gel').length === 1);

(async () => {
  // ---- access ----
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.kpis.completedServicesToday === 0 && other.tickets.items.length === 0);

  // ---- state + KPIs ----
  const st = await svc().getState(owner());
  ok('seed has completed tickets', st.tickets.items.length >= 5);
  ok('kpis: ready for review counts pending/needs_review', st.kpis.ticketsReadyForReview >= 1);
  ok('kpis: ready for checkout counted', st.kpis.ticketsReadyForCheckout >= 1);
  ok('kpis: quality issues counted', st.kpis.qualityIssuesCount >= 1);
  ok('kpis: avg duration > 0', st.kpis.averageServiceDurationMinutes > 0);
  ok('kpis: estimated sales; commission is payroll\'s (null, ONE-PAY)', st.kpis.estimatedSalesCents > 0 && st.kpis.estimatedCommissionCents === null);
  ok('rows carry quality + checkout status + commission', st.tickets.items.every((t) => !!t.qualityStatus && !!t.checkoutStatus && t.estimatedCommissionCents === null));
  ok('facets present', st.filters.qualityStatuses.includes('approved') && st.filters.statuses.includes('sent_to_checkout'));
  ok('workflow settings exposed', st.workflowSettings.requireQualityCheckBeforeCheckout === true);

  // ---- filters ----
  ok('filter qualityStatus=issue_found', (await svc().tickets(owner(), { qualityStatus: 'issue_found' })).items.every((t) => t.qualityStatus === 'issue_found'));
  ok('filter checkoutStatus=ready_for_checkout', (await svc().tickets(owner(), { checkoutStatus: 'ready_for_checkout' })).items.every((t) => t.checkoutStatus === 'ready_for_checkout'));
  ok('search by customer', (await svc().tickets(owner(), { search: 'Grace' })).items.length >= 1);
  const paged = await svc().getState(owner(), { page: 1, pageSize: 2 });
  ok('pagination respected', paged.tickets.items.length === 2 && paged.tickets.pagination.totalPages >= 3);

  // ---- detail ----
  const d = await svc().detail(owner(), 'sd_3001');
  ok('detail has services + quality checklist', d.services.length >= 1 && typeof d.qualityChecklist.allServicesCompleted === 'boolean');

  // ---- quality check ----
  const s2 = svc();
  ok('quality approve', (await s2.qualityCheck(owner(), 'sd_3001', { result: 'approved' })).qualityStatus === 'approved');
  await throwsAsync('quality needs result', () => svc().qualityCheck(owner(), 'sd_3001', {} as any), ValidationError);
  await throwsAsync('quality needs perm', () => svc().qualityCheck(owner({ permissions: ['pos.service_done.view'] }), 'sd_3001', { result: 'approved' }), ForbiddenError);
  ok('audit: quality checked', s2.auditLog().some((l) => l.actionType === 'pos_service_done_quality_checked'));

  // ---- notes ----
  const s3 = svc();
  ok('notes update', (await s3.updateNotes(owner(), 'sd_3001', { notes: 'Customer loved the design' })).notes === 'Customer loved the design');
  await throwsAsync('notes need perm', () => svc().updateNotes(owner({ permissions: ['pos.service_done.view'] }), 'sd_3001', { notes: 'x' }), ForbiddenError);
  ok('audit: notes updated', s3.auditLog().some((l) => l.actionType === 'pos_service_done_notes_updated'));

  // ---- technician / helper ----
  const s4 = svc();
  ok('technicians list', (await s4.technicians(owner())).length >= 1);
  ok('assign technician', (await s4.assignTechnician(owner(), 'sd_3001', { technicianId: 'tech_ava' })).primaryTechnician!.name === 'Ava');
  await throwsAsync('assign unknown tech rejected', () => svc().assignTechnician(owner(), 'sd_3001', { technicianId: 'nope' }), ValidationError);
  ok('assign helper', (await s4.assignHelper(owner(), 'sd_3001', { technicianId: 'tech_leo' })).helperTechnician!.name === 'Leo');
  ok('clear helper', (await s4.assignHelper(owner(), 'sd_3001', { technicianId: null })).helperTechnician === null);
  ok('audit: technician + helper assigned', s4.auditLog().some((l) => l.actionType === 'pos_service_done_technician_assigned') && s4.auditLog().some((l) => l.actionType === 'pos_service_done_helper_assigned'));

  // ---- mark ready ----
  const s5 = svc();
  await throwsAsync('mark ready blocked when quality pending', () => s5.markReady(owner(), 'sd_3001'), ValidationError);
  await s5.qualityCheck(owner(), 'sd_3001', { result: 'approved' });
  ok('mark ready after approval', (await s5.markReady(owner(), 'sd_3001')).checkoutStatus === 'ready_for_checkout');
  ok('audit: marked ready', s5.auditLog().some((l) => l.actionType === 'pos_service_done_marked_ready_for_checkout'));

  // ---- send to checkout (idempotent, no duplicate) ----
  const s6 = svc();
  await throwsAsync('send blocked when quality not approved', () => s6.sendToCheckout(owner(), 'sd_3004'), ValidationError);
  const send1 = await s6.sendToCheckout(owner(), 'sd_3003');
  ok('send to checkout succeeds', send1.sent === true && send1.duplicate === false);
  ok('ticket now sent_to_checkout', (await s6.tickets(owner(), { status: 'sent_to_checkout' })).items.some((t) => t.ticketId === 'sd_3003'));
  const send2 = await s6.sendToCheckout(owner(), 'sd_3003');
  ok('send is idempotent (no duplicate)', send2.duplicate === true && send2.idempotencyKey === send1.idempotencyKey);
  await throwsAsync('send needs checkout.view too', () => svc().sendToCheckout(owner({ permissions: ['pos.service_done.view','pos.service_done.send_to_checkout'] }), 'sd_3003'), ForbiddenError);
  ok('audit: sent to checkout', s6.auditLog().some((l) => l.actionType === 'pos_service_done_sent_to_checkout' && l.entityType === 'pos_checkout_transfer'));

  // ---- customer notification (honest) ----
  const s7 = svc();
  const sms = await s7.notifyCustomer(owner(), 'sd_3001', { channel: 'sms' });
  ok('sms notify not configured (honest)', sms.configured === false && /not configured/i.test(sms.disabledReason!));
  const fd = await s7.notifyCustomer(owner(), 'sd_3001', { channel: 'front_desk' });
  ok('front-desk notify works + sets notified', fd.configured === true && !!(await s7.detail(owner(), 'sd_3001')).customerNotifiedAt);
  await throwsAsync('notify needs perm', () => svc().notifyCustomer(owner({ permissions: ['pos.service_done.view'] }), 'sd_3001', { channel: 'front_desk' }), ForbiddenError);
  ok('audit: customer notified', s7.auditLog().some((l) => l.actionType === 'pos_service_done_customer_notified'));

  // ---- reopen ----
  const s8 = svc();
  await throwsAsync('reopen needs reason', () => svc().reopen(owner(), 'sd_3005', { reason: '' }), ValidationError);
  await throwsAsync('reopen needs permission', () => svc().reopen(owner({ permissions: ['pos.service_done.view'] }), 'sd_3005', { reason: 'redo' }), ForbiddenError);
  ok('reopen via serving.reopen permission allowed', (await s8.reopen(owner({ permissions: ['pos.service_done.view','pos.serving.reopen'] }), 'sd_3005', { reason: 'Customer wants a change' })).status === 'reopened');
  ok('audit: reopened', s8.auditLog().some((l) => l.actionType === 'pos_service_done_reopened'));

  // ---- audit base ----
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_service_done_viewed' && l.tenantId === 'luxe001'));

  console.log(`\nservice-done-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
