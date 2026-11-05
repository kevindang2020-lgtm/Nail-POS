// serving-core.spec.ts — Nest-free harness for the (async) Serving service + repository + pure dto helpers.
import { InMemoryServingRepository, ServingContext } from './serving.repository';
import { ServingService, ForbiddenError, ValidationError } from './serving.service';
import { computeElapsedMinutes, deriveDelayStatus, canMarkDone, canSendToServiceDone, buildServiceDoneIdempotencyKey, subtotalFromServingLines, servingSearch, DEFAULT_SERVING_SETTINGS } from './serving.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new ServingService(new InMemoryServingRepository());
const PERMS = ['pos.serving.view','pos.serving.start','pos.serving.pause_resume','pos.serving.update_notes','pos.serving.edit_services','pos.serving.assign_technician','pos.serving.assign_helper','pos.serving.mark_done','pos.serving.send_to_service_done','pos.serving.report_delay','pos.service_done.view','pos.reports.view'];
const owner = (over: Partial<ServingContext> = {}): ServingContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

// ---- pure helpers (synchronous) ----
const t0 = 10_000_000;
ok('elapsed: running 20m', computeElapsedMinutes({ startedAtMs: t0, pausedAtMs: null, accumulatedPausedMs: 0, nowMs: t0 + 20 * 60000 }) === 20);
ok('elapsed: paused excludes current pause', computeElapsedMinutes({ startedAtMs: t0, pausedAtMs: t0 + 10 * 60000, accumulatedPausedMs: 0, nowMs: t0 + 25 * 60000 }) === 10);
ok('elapsed: accumulated paused removed', computeElapsedMinutes({ startedAtMs: t0, pausedAtMs: null, accumulatedPausedMs: 5 * 60000, nowMs: t0 + 30 * 60000 }) === 25);
ok('elapsed: not started = 0', computeElapsedMinutes({ startedAtMs: null, pausedAtMs: null, accumulatedPausedMs: 0, nowMs: t0 }) === 0);
ok('delay none when under est', deriveDelayStatus(40, 45, 10) === 'none');
ok('delay warning just over', deriveDelayStatus(50, 45, 10) === 'warning');
ok('delay late further over', deriveDelayStatus(70, 45, 10) === 'late');
ok('delay critical way over', deriveDelayStatus(120, 45, 10) === 'critical');
ok('canMarkDone blocks not-in-service', !canMarkDone('not_started', '', DEFAULT_SERVING_SETTINGS).ok);
ok('canMarkDone allows in-service', canMarkDone('in_service', '', DEFAULT_SERVING_SETTINGS).ok);
ok('canMarkDone enforces notes when required', !canMarkDone('in_service', '', { ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true }).ok);
ok('canSendToServiceDone blocks already sent', !canSendToServiceDone('sent_to_service_done').ok);
ok('idempotency stable per subtotal', buildServiceDoneIdempotencyKey('t1', 7000) === 't1:send_to_service_done:7000');
ok('subtotal sums lines', subtotalFromServingLines([{ priceCents: 5500 }, { priceCents: 1500 }]) === 7000);
ok('servingSearch matches', servingSearch([{ ticketId: 'a', ticketNumber: '#1', tenantId: 't', customerName: 'X', serviceCount: 1, serviceNames: ['Gel Manicure'], elapsedMinutes: 0, subtotalCents: 0, status: 'in_service' }], 'gel').length === 1);

(async () => {
  // ---- access ----
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.kpis.activeTickets === 0 && other.tickets.items.length === 0);

  // ---- state + KPIs ----
  const st = await svc().getState(owner());
  ok('seed has tickets', st.tickets.items.length >= 5);
  ok('kpis: serving now', st.kpis.servingNow >= 1);
  ok('kpis: active tickets', st.kpis.activeTickets >= 3);
  ok('kpis: delayed counted', st.kpis.delayedServices >= 1);
  ok('kpis: in-service sales + duration', st.kpis.totalInServiceSalesCents > 0 && st.kpis.averageServiceDurationMinutes >= 0);
  ok('rows carry timer + status + commission', st.tickets.items.every((t) => typeof t.elapsedMinutes === 'number' && !!t.status && t.estimatedCommissionCents === null));
  ok('in-service row has elapsed > 0', st.tickets.items.some((t) => t.status === 'in_service' && t.elapsedMinutes > 0));
  ok('facets present', st.filters.statuses.includes('sent_to_service_done') && st.filters.delayStatuses.includes('critical'));
  ok('workflow settings exposed', st.workflowSettings.allowPauseResume === true);
  ok('services + technicians catalog', (await svc().services(owner())).length >= 1 && (await svc().technicians(owner())).length >= 1);

  // ---- filters ----
  ok('filter status=paused', (await svc().tickets(owner(), { status: 'paused' })).items.every((t) => t.status === 'paused'));
  ok('filter status=delayed', (await svc().tickets(owner(), { status: 'delayed' })).items.every((t) => t.status === 'delayed'));
  ok('search by customer', (await svc().tickets(owner(), { search: 'Grace' })).items.length >= 1);
  const paged = await svc().getState(owner(), { page: 1, pageSize: 2 });
  ok('pagination respected', paged.tickets.items.length === 2 && paged.tickets.pagination.totalPages >= 3);

  // ---- detail ----
  const d = await svc().detail(owner(), 'sv_4001');
  ok('detail has services + timer', d.services.length >= 1 && d.elapsedMinutes >= 0);

  // ---- timer state machine ----
  const s2 = svc();
  ok('start a not-started ticket', (await s2.start(owner(), 'sv_4003')).status === 'in_service');
  await throwsAsync('cannot start an already in-service ticket', () => s2.start(owner(), 'sv_4003'), ValidationError);
  ok('pause an in-service ticket', (await s2.pause(owner(), 'sv_4003')).status === 'paused');
  await throwsAsync('cannot pause a paused ticket', () => s2.pause(owner(), 'sv_4003'), ValidationError);
  ok('resume a paused ticket', (await s2.resume(owner(), 'sv_4003')).status === 'in_service');
  await throwsAsync('start needs perm', () => svc().start(owner({ permissions: ['pos.serving.view'] }), 'sv_4003'), ForbiddenError);
  await throwsAsync('pause needs perm', () => svc().pause(owner({ permissions: ['pos.serving.view'] }), 'sv_4001'), ForbiddenError);
  ok('audit: started/paused/resumed', s2.auditLog().some((l) => l.actionType === 'pos_serving_started') && s2.auditLog().some((l) => l.actionType === 'pos_serving_paused') && s2.auditLog().some((l) => l.actionType === 'pos_serving_resumed'));

  // ---- timer persists (server-truth): seeded sv_4001 started ~20m ago ----
  ok('elapsed persists from server time', (await svc().detail(owner(), 'sv_4001')).elapsedMinutes >= 19);

  // ---- notes ----
  const s3 = svc();
  ok('notes update', (await s3.updateNotes(owner(), 'sv_4001', { notes: 'Customer prefers shorter length' })).notes === 'Customer prefers shorter length');
  await throwsAsync('notes need perm', () => svc().updateNotes(owner({ permissions: ['pos.serving.view'] }), 'sv_4001', { notes: 'x' }), ForbiddenError);
  ok('audit: notes updated', s3.auditLog().some((l) => l.actionType === 'pos_serving_notes_updated'));

  // ---- service lines ----
  const s4 = svc();
  const beforeSub = (await s4.detail(owner(), 'sv_4001')).subtotalCents;
  const added = await s4.addService(owner(), 'sv_4001', { serviceId: 'svc_art' });
  ok('add service increases subtotal', added.subtotalCents > beforeSub && added.services.some((l) => l.serviceName === 'Nail Art'));
  await throwsAsync('add unknown service rejected', () => svc().addService(owner(), 'sv_4001', { serviceId: 'nope' }), ValidationError);
  const lineId = added.services.find((l) => l.serviceName === 'Nail Art')!.serviceLineId;
  ok('edit service price', (await s4.editService(owner(), 'sv_4001', lineId, { priceOverrideCents: 2500 })).services.find((l) => l.serviceLineId === lineId)!.priceCents === 2500);
  ok('remove service', (await s4.removeService(owner(), 'sv_4001', { serviceLineId: lineId })).services.every((l) => l.serviceLineId !== lineId));
  await throwsAsync('service edit needs perm', () => svc().addService(owner({ permissions: ['pos.serving.view'] }), 'sv_4001', { serviceId: 'svc_art' }), ForbiddenError);
  ok('audit: service added/updated/removed', s4.auditLog().some((l) => l.actionType === 'pos_serving_service_added') && s4.auditLog().some((l) => l.actionType === 'pos_serving_service_updated') && s4.auditLog().some((l) => l.actionType === 'pos_serving_service_removed'));

  // ---- technician / helper ----
  const s5 = svc();
  ok('assign technician', (await s5.assignTechnician(owner(), 'sv_4001', { technicianId: 'tech_ava' })).primaryTechnician!.name === 'Ava');
  await throwsAsync('assign unknown tech rejected', () => svc().assignTechnician(owner(), 'sv_4001', { technicianId: 'nope' }), ValidationError);
  ok('assign helper', (await s5.assignHelper(owner(), 'sv_4001', { technicianId: 'tech_leo' })).helperTechnician!.name === 'Leo');
  ok('clear helper', (await s5.assignHelper(owner(), 'sv_4001', { technicianId: null })).helperTechnician === null);
  ok('audit: technician + helper assigned', s5.auditLog().some((l) => l.actionType === 'pos_serving_technician_assigned') && s5.auditLog().some((l) => l.actionType === 'pos_serving_helper_assigned'));

  // ---- mark done / send to service done (idempotent) ----
  const s6 = svc();
  ok('mark done an in-service ticket', ((await s6.markDone(owner(), 'sv_4001')) as any).status === 'completed');
  await throwsAsync('cannot mark done a not-started ticket', () => svc().markDone(owner(), 'sv_4003'), ValidationError);
  const send1: any = await s6.sendToServiceDone(owner(), 'sv_4001');
  ok('send to service done succeeds', send1.sent === true && send1.duplicate === false);
  ok('ticket now sent_to_service_done', (await s6.tickets(owner(), { status: 'sent_to_service_done' })).items.some((t) => t.ticketId === 'sv_4001'));
  const send2: any = await s6.sendToServiceDone(owner(), 'sv_4001');
  ok('send is idempotent (no duplicate)', send2.duplicate === true && send2.idempotencyKey === send1.idempotencyKey);
  await throwsAsync('send needs service_done.view too', () => svc().sendToServiceDone(owner({ permissions: ['pos.serving.view','pos.serving.send_to_service_done'] }), 'sv_4005'), ForbiddenError);
  ok('audit: marked done + sent', s6.auditLog().some((l) => l.actionType === 'pos_serving_marked_done') && s6.auditLog().some((l) => l.actionType === 'pos_serving_sent_to_service_done' && l.entityType === 'pos_service_done_transfer'));

  // ---- auto-send variant ----
  const autoRepo = new InMemoryServingRepository();
  (autoRepo as any).settings = () => ({ ...DEFAULT_SERVING_SETTINGS, autoSendToServiceDone: true });
  const sAuto = new ServingService(autoRepo);
  const auto: any = await sAuto.markDone(owner(), 'sv_4001');
  ok('auto-send: mark done sends to service done', auto.sent === true && auto.serviceDoneTicketId === 'sv_4001');

  // ---- delay ----
  const s7 = svc();
  await throwsAsync('report delay needs reason', () => svc().reportDelay(owner(), 'sv_4001', { reason: '' }), ValidationError);
  ok('report delay sets delayed', (await s7.reportDelay(owner(), 'sv_4001', { reason: 'Add-on requested', extraMinutes: 15 })).status === 'delayed');
  ok('delay severity from extra minutes', (await s7.detail(owner(), 'sv_4001')).delayStatus === 'late');
  await throwsAsync('clear delay needs note', () => svc().clearDelay(owner(), 'sv_4004', { note: '' }), ValidationError);
  ok('clear delay resets', (await s7.clearDelay(owner(), 'sv_4001', { note: 'Resolved' })).delayStatus === 'none');
  await throwsAsync('delay needs perm', () => svc().reportDelay(owner({ permissions: ['pos.serving.view'] }), 'sv_4001', { reason: 'x' }), ForbiddenError);
  ok('audit: delay reported + cleared', s7.auditLog().some((l) => l.actionType === 'pos_serving_delay_reported') && s7.auditLog().some((l) => l.actionType === 'pos_serving_delay_cleared'));

  // ---- audit base ----
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_serving_viewed' && l.tenantId === 'luxe001'));

  // ---- add-on suggestions + tech add-on flow (master doc §Serving "Add-ons"; tech poster screen 4) ----
  const sA = svc();
  const tctx = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_tech_mia', role: 'TECHNICIAN', permissions: [] as string[] };
  const sugg1 = await sA.techAddOnSuggestions(tctx, 'sv_4001'); // sv_4001 is in_service and already carries svc_gel
  ok('suggestions: exactly the Add-on services NOT already on the ticket (svc_art only)', sugg1.length === 1 && sugg1[0].serviceId === 'svc_art' && sugg1[0].priceCents === 2000 && sugg1[0].source === 'service_category');
  const posDet = await sA.detail(owner(), 'sv_4001');
  ok('POS detail now populates addOnSuggestions (field existed but was never filled)', Array.isArray(posDet.addOnSuggestions) && posDet.addOnSuggestions!.length === 1 && posDet.addOnSuggestions![0].serviceId === 'svc_art');
  await throwsAsync('tech add: non-Add-on service rejected', () => sA.techAddAddOn(tctx, 'sv_4001', 'svc_mani', 'tech_mia'), ValidationError);
  await throwsAsync('tech add: unknown service rejected', () => sA.techAddAddOn(tctx, 'sv_4001', 'svc_ghost', 'tech_mia'), ValidationError);
  const addedRes = await sA.techAddAddOn(tctx, 'sv_4001', 'svc_art', 'tech_mia');
  ok('tech add: ok with the catalog price snapshot', addedRes.ok === true && addedRes.serviceName === 'Nail Art' && addedRes.priceCents === 2000);
  const det2 = await sA.detail(owner(), 'sv_4001');
  const line2 = (det2.services as any[]).find((l) => l.serviceId === 'svc_art');
  ok('line landed as isAddOn, attributed to the technician', !!line2 && line2.isAddOn === true && line2.technicianId === 'tech_mia' && line2.technicianName === 'Mia' && line2.priceCents === 2000);
  ok('added add-on disappears from suggestions', (await sA.techAddOnSuggestions(tctx, 'sv_4001')).length === 0);
  ok('audit: technician_addon_added recorded', sA.auditLog().some((l) => l.actionType === 'technician_addon_added' && l.tenantId === 'luxe001'));
  const lockedRepo: any = new Proxy(new InMemoryServingRepository(), {
    get(t, k) { if (k === 'settings') return async (c: any) => ({ ...(await (t as any).settings(c)), allowServiceEditDuringServing: false }); const v = (t as any)[k]; return typeof v === 'function' ? v.bind(t) : v; },
  });
  await throwsAsync('tech add: blocked when the salon disallows edits during serving (no override path)', () => new ServingService(lockedRepo).techAddAddOn(tctx, 'sv_4001', 'svc_art', 'tech_mia'), ValidationError);

  // ════════ Tech Live Ticket Edit matrix (build doc §5–§9) ════════
  const sE = svc();
  // §10 edit-options: full catalog + §7 matrix + editability
  const opts: any = await sE.techEditOptions(tctx, 'sv_4001');
  ok('edit-options: editable, full catalog with categories, §7 matrix from settings',
    opts.editable === true && opts.lockedReason === null && opts.categories.includes('Add-on') && opts.services.length >= 3
    && opts.can.addService === true && opts.can.changeService === true && opts.can.removeLine === false
    && opts.approvalRequiredFor.includes('change_service') && opts.approvalRequiredFor.includes('remove_line'),
    JSON.stringify({ can: opts.can, approval: opts.approvalRequiredFor }));
  // §8 add ANY active service (not just Add-on)
  const nonAddon = opts.services.find((x: any) => !x.isAddOn);
  const addRes: any = await sE.techAddService(tctx, 'sv_4001', { serviceId: nonAddon.serviceId, notes: 'requested chrome upgrade' }, 'tech_mia');
  ok('tech add ANY service: ok + exact success message', addRes.ok === true && addRes.message === 'Service added to ticket.');
  const dAfterAdd: any = await sE.detail(owner(), 'sv_4001');
  const newLine = (dAfterAdd.services as any[]).find((l) => l.serviceLineId === addRes.serviceLineId);
  ok('added line landed with price snapshot + tech attribution + non-add-on flag', !!newLine && newLine.priceCents === nonAddon.priceCents && newLine.technicianId === 'tech_mia' && newLine.isAddOn === false);
  // §6 verbatim lock: find a seeded ticket whose raw status is service_done
  // drive a seeded ticket to the sent-to-checkout state deterministically
  const lockTarget = ((sE as any).repo.store.get('luxe001') as any[]).find((t) => t.ticketId !== 'sv_4001');
  lockTarget.status = 'sent_to_service_done';
  ok('raw status maps sent-to-checkout -> service_done', (await (sE as any).repo.rawTicketStatus(tctx, lockTarget.ticketId)) === 'service_done');
  let lockedMsg = '';
  try { await sE.techAddService(tctx, lockTarget.ticketId, { serviceId: nonAddon.serviceId }, 'tech_mia'); } catch (e: any) { lockedMsg = e.message; }
  ok('§6 VERBATIM locked message on a sent-to-checkout ticket', lockedMsg === 'This ticket is already locked for checkout or payment. Please contact the front desk.', lockedMsg);
  // §9 change service — default settings require approval: nothing applies, snapshots stored
  const gelLine = (dAfterAdd.services as any[]).find((l) => l.serviceId === 'svc_gel');
  const chg: any = await sE.techChangeService(tctx, 'sv_4001', gelLine.serviceLineId, 'svc_art', 'Customer changed her mind', 'tech_mia');
  ok('change-service goes to approval by default with exact message', chg.pendingApproval === true && chg.message === 'This service requires manager approval.' && !!chg.requestId);
  const dUnchanged: any = await sE.detail(owner(), 'sv_4001');
  ok('pending change did NOT touch the line', (dUnchanged.services as any[]).find((l) => l.serviceLineId === gelLine.serviceLineId).serviceId === 'svc_gel');
  const reqs: any[] = await sE.techListChangeRequests(tctx, 'sv_4001');
  ok('§9 storage: old/new snapshots + reason on the request row', reqs.length === 1 && reqs[0].oldValue.serviceId === 'svc_gel' && reqs[0].newValue.serviceId === 'svc_art' && reqs[0].reason === 'Customer changed her mind' && reqs[0].requestedByTechnicianId === 'tech_mia');
  // §7 POS decision: reject leaves the line; approve on a second request applies it through the same writer
  const rej: any = await sE.decideChangeRequest(owner(), chg.requestId, 'reject');
  ok('manager reject: status rejected, line still original', rej.status === 'rejected' && ((await sE.detail(owner(), 'sv_4001')).services as any[]).find((l) => l.serviceLineId === gelLine.serviceLineId).serviceId === 'svc_gel');
  const notifAfterReject = (sE as any).repo.techNotifications;
  ok('§28: rejection writes a technician notification with the change details', notifAfterReject.length === 1 && notifAfterReject[0].technicianId === 'tech_mia' && notifAfterReject[0].title === 'Service change rejected' && /not approved/.test(notifAfterReject[0].body || ''), JSON.stringify(notifAfterReject[0] || {}));
  const chg2: any = await sE.techChangeService(tctx, 'sv_4001', gelLine.serviceLineId, 'svc_art', 'second ask', 'tech_mia');
  const app: any = await sE.decideChangeRequest(owner(), chg2.requestId, 'approve');
  const dApplied: any = await sE.detail(owner(), 'sv_4001');
  const changed = (dApplied.services as any[]).find((l) => l.serviceLineId === gelLine.serviceLineId);
  ok('manager approve: applied through the single writer (service + price swapped)', app.status === 'applied' && changed.serviceId === 'svc_art' && changed.priceCents === 2000);
  const notifAfterApprove = (sE as any).repo.techNotifications;
  ok('§28: approval writes a technician notification', notifAfterApprove.length === 2 && notifAfterApprove[1].title === 'Service change approved' && notifAfterApprove[1].reference === 'sv_4001');
  // remove: default techCanRemoveLine=false
  let removeMsg = '';
  try { await sE.techRemoveLine(tctx, 'sv_4001', changed.serviceLineId, undefined, 'tech_mia'); } catch (e: any) { removeMsg = e.message; }
  ok('remove blocked by default permission setting', removeMsg === 'You do not have permission to remove this service.');
  // §7 settings-driven: a salon that allows direct change + removal applies immediately
  const openRepo: any = new Proxy(new InMemoryServingRepository(), {
    get(t, k) { if (k === 'settings') return async (c: any) => ({ ...(await (t as any).settings(c)), requireApprovalForChangeService: false, techCanRemoveLine: true, requireApprovalForRemoveLine: false }); const v = (t as any)[k]; return typeof v === 'function' ? v.bind(t) : v; },
  });
  const sOpen = new ServingService(openRepo);
  const dO: any = await sOpen.detail(owner(), 'sv_4001');
  const gelO = (dO.services as any[]).find((l) => l.serviceId === 'svc_gel');
  const chgO: any = await sOpen.techChangeService(tctx, 'sv_4001', gelO.serviceLineId, 'svc_art', undefined, 'tech_mia');
  ok('no-approval salon: change applies immediately with price delta', chgO.pendingApproval === false && chgO.priceDeltaCents === 2000 - gelO.priceCents);
  const remO: any = await sOpen.techRemoveLine(tctx, 'sv_4001', gelO.serviceLineId, 'not wanted', 'tech_mia');
  const dO2: any = await sOpen.detail(owner(), 'sv_4001');
  ok('no-approval salon: removal applies and the line is gone', remO.pendingApproval === false && !(dO2.services as any[]).some((l) => l.serviceLineId === gelO.serviceLineId));
  // line patch: notes + done status; bad status rejected
  const firstLine = (dO2.services as any[])[0];
  await sOpen.techPatchLine(tctx, 'sv_4001', firstLine.serviceLineId, { notes: 'extra coat', status: 'done' }, 'tech_mia');
  const dO3: any = await sOpen.detail(owner(), 'sv_4001');
  ok('line patch: status done persisted', (dO3.services as any[]).find((l) => l.serviceLineId === firstLine.serviceLineId).status === 'done');
  await throwsAsync('line patch: invalid status rejected', () => sOpen.techPatchLine(tctx, 'sv_4001', firstLine.serviceLineId, { status: 'flying' }, 'tech_mia'), ValidationError);
  // §26 platform kill switch: tech_live_ticket_edit off → options report it, every edit entry throws the exact message
  const offRepo: any = new InMemoryServingRepository();
  offRepo.techEditFlag = false;
  const sOff = new ServingService(offRepo);
  const offOpts: any = await sOff.techEditOptions(tctx, 'sv_4001');
  ok('§26 kill switch: edit-options report disabled with the exact reason', offOpts.editable === false && offOpts.lockedReason === 'Live ticket editing is disabled for this salon.', String(offOpts.lockedReason));
  let offMsg = '';
  try { await sOff.techAddService(tctx, 'sv_4001', { serviceId: 'svc_art' }, 'tech_mia'); } catch (e: any) { offMsg = e.message; }
  ok('§26 kill switch: add throws the exact disabled message', offMsg === 'Live ticket editing is disabled for this salon.', offMsg);

  console.log(`\nserving-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
