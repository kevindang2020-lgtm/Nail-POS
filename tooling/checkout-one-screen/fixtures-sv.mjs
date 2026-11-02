// fixtures-sv.mjs — Serving one-screen datasets (tooling only; Serving mandate Oct 28 2026 §10, §86–§89). Shapes follow
// GET /pos/serving/state and /pos/serving/tickets/:id. Money is integer cents. The fixture is STATEFUL so the E2E run can
// prove a tap changes the server's answer: start / pause / resume / mark ready / send / add-service / add-retail /
// notify-customer / staff-alert / assign-technician mutate the model and the next GET reflects it.
//   empty    nothing on the floor                         normal   8 guests across every stage, a quiet morning
//   busy     §86: 200 technicians (100 on duty), 40 actively serving, 10 finishing soon, 8 ready for Service Done,
//            5 delayed, 3 ready to start, add-ons, multi-technician visits, AI insights
//   tech200  normal floor with the 200-technician roster    q100   §88: 100 active service rows    long  §89: long names
// `server=old` (BEFORE): the server as it was — staff = every technician on duty, decorative 0 KPIs, no allowedActions,
// no stage counts; otherwise it answers like the fixed server.
const FIRST = ['Ann', 'Bao', 'Chloe', 'Diana', 'Emily', 'Fiona', 'Grace', 'Hana', 'Ivy', 'Jenny', 'Kim', 'Linh', 'Mai', 'Nora', 'Olivia', 'Phuong', 'Quinn', 'Rosa', 'Sara', 'Thao'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vo', 'Smith', 'Johnson', 'Garcia', 'Martinez'];
const TECH = ['Lisa Tran', 'Mary Nguyen', 'Anna Pham', 'Kelly Le', 'Tina Vo', 'Jenny Hoang', 'Amy Dang', 'Vivian Do', 'Helen Bui', 'Cindy Ngo'];
const SVC = [['Gel Manicure', 4500, 'Manicure', 45], ['Spa Pedicure', 5500, 'Pedicure', 55], ['Acrylic Full Set', 6500, 'Enhancement', 75], ['Dip Powder', 5000, 'Enhancement', 60], ['Deluxe Pedicure', 7500, 'Pedicure', 65]];
const ADDONS = [['Nail Art (2 nails)', 1500, 15], ['Gel Removal', 1000, 10], ['French Tip', 1000, 10], ['Paraffin Dip', 1200, 10]];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FRACTION = 0.85;

function build(name) {
  // stage plan: rts = ready to start, in = in service (early), fin = finishing soon, pau = paused, del = delayed, rdy = ready for Service Done
  const plans = {
    empty: [], normal: ['rts', 'in', 'in', 'fin', 'pau', 'del', 'rdy', 'in'],
    busy: [...Array(3).fill('rts'), ...Array(25).fill('in'), ...Array(10).fill('fin'), ...Array(5).fill('del'), ...Array(8).fill('rdy')],
    q100: Array.from({ length: 100 }, (_, i) => ['in', 'in', 'fin', 'del', 'rts', 'rdy'][i % 6]),
  };
  const plan = plans[name] ?? plans.normal;
  const nTech = name === 'busy' || name === 'tech200' ? 200 : 10; const onDuty = name === 'busy' || name === 'tech200' ? 100 : 8;
  const long = name === 'long';
  const tickets = plan.map((st, n) => {
    const s = SVC[n % SVC.length]; const multi = n % 4 === 1; const add = n % 3 === 0;
    const tech = long ? 'Christina-Marie Nguyen-Thompson' : TECH[n % TECH.length]; const tech2 = TECH[(n + 3) % TECH.length];
    const lines = [{ serviceLineId: id(20000 + n * 10), serviceId: id(30000 + (n % 5)), serviceName: long ? 'Signature Deluxe Hot-Stone Spa Pedicure with Paraffin' : s[0], category: s[2], priceCents: s[1], technicianId: id(9000 + (n % TECH.length)), technicianName: tech, status: 'serving', isAddOn: false, estDurationMin: s[3] }];
    if (multi) { const s2 = SVC[(n + 1) % SVC.length]; lines.push({ serviceLineId: id(20000 + n * 10 + 1), serviceId: id(30000 + ((n + 1) % 5)), serviceName: s2[0], category: s2[2], priceCents: s2[1], technicianId: id(9000 + ((n + 3) % TECH.length)), technicianName: tech2, status: 'serving', isAddOn: false, estDurationMin: 0 }); }
    if (add) { const a = ADDONS[n % ADDONS.length]; lines.push({ serviceLineId: id(20000 + n * 10 + 2), serviceId: id(31000 + (n % 4)), serviceName: a[0], category: 'Add-on', priceCents: a[1], technicianId: id(9000 + (n % TECH.length)), technicianName: tech, status: 'serving', isAddOn: true, estDurationMin: a[2] }); }
    const est = lines.reduce((x, l) => x + l.estDurationMin, 0);
    const elapsed = st === 'rts' ? 0 : st === 'in' ? 8 + (n % 5) * 5 : st === 'fin' ? Math.ceil(est * 0.9) : st === 'del' ? est + 18 : st === 'pau' ? 20 : est;
    const status = st === 'rts' ? 'not_started' : st === 'pau' ? 'paused' : st === 'del' ? 'delayed' : st === 'rdy' ? 'completed' : 'in_service';
    const cust = long ? `${FIRST[n % FIRST.length]}-Alexandra ${LAST[n % LAST.length]}-Washington-Montgomery` : `${FIRST[n % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`;
    return { ticketId: id(1000 + n), ticketNumber: '#' + (3040 + n), customerId: id(5000 + n), customerName: cust, customerPhone: `(856) 555-${String(1000 + n).slice(-4)}`, isVip: n % 9 === 4,
      station: `Station ${1 + (n % 12)}`, lines, primaryTechId: id(9000 + (n % TECH.length)), primaryTechName: tech, helperTechName: multi ? tech2 : undefined,
      status, elapsed, est, startedAt: status === 'not_started' ? null : new Date(Date.now() - elapsed * 60000).toISOString(), delayStatus: st === 'del' ? 'late' : 'none', delayReason: st === 'del' ? 'Add-on requested mid-service' : undefined, notes: n % 5 === 0 ? 'Prefers short square shape.' : '', version: 1 };
  });
  const ST = ['Busy', 'Available', 'Finishing Soon', 'Break'];
  const staffAll = Array.from({ length: onDuty }, (_, i) => ({ technicianId: id(9000 + i), name: i < TECH.length ? TECH[i] : `Technician ${i + 1}`, specialty: ['Manicure', 'Pedicure', 'Enhancement'][i % 3], currentLoad: ST[i % 4] === 'Busy' ? 1 : 0, nextAvailable: ST[i % 4] === 'Available' ? 'Now' : ST[i % 4] === 'Finishing Soon' ? 'Soon' : '—', status: ST[i % 4] }));
  return { tickets, staffAll, nTech, onDuty };
}

const sum = (ls) => ls.reduce((a, l) => a + l.priceCents, 0);
const ACTIONS = (t) => {
  const a = [];
  if (t.status === 'not_started') a.push('start');
  if (t.status === 'in_service') a.push('pause');
  if (t.status === 'paused') a.push('resume');
  if (t.status === 'in_service' || t.status === 'delayed') a.push('report_delay');
  if (t.status === 'delayed') a.push('clear_delay');
  if (['in_service', 'paused', 'delayed'].includes(t.status)) a.push('mark_ready');
  if (['in_service', 'paused', 'delayed', 'completed'].includes(t.status)) a.push('send_to_service_done');
  return a;
};
const finishing = (t) => t.est > 0 && t.elapsed >= t.est * FRACTION && t.status === 'in_service';
const stage = (t) => t.status === 'completed' || t.status === 'sent_to_service_done' ? 'Ready' : t.status === 'paused' ? 'Paused' : t.status === 'delayed' ? 'Delayed' : t.status === 'not_started' ? 'Ready to Start' : finishing(t) ? 'Finishing Soon' : 'In Service';

function row(t, server) {
  return { ticketId: t.ticketId, ticketNumber: t.ticketNumber, tenantId: 't', customerId: t.customerId, customerName: t.customerName, customerPhone: t.customerPhone, isVip: t.isVip, station: t.station,
    serviceCount: t.lines.length, serviceNames: t.lines.filter((l) => !l.isAddOn).map((l) => l.serviceName), stage: stage(t), addOnsLabel: t.lines.filter((l) => l.isAddOn).map((l) => l.serviceName).join(', ') || undefined,
    primaryTechnicianId: t.primaryTechId, primaryTechnicianName: t.primaryTechName, helperTechnicianName: t.helperTechName,
    startedAt: t.startedAt ?? undefined, pausedAt: t.status === 'paused' ? new Date().toISOString() : null, estimatedEndAt: t.startedAt ? new Date(new Date(t.startedAt).getTime() + t.est * 60000).toISOString() : null,
    elapsedMinutes: t.elapsed, estimatedDurationMinutes: t.est, subtotalCents: sum(t.lines), estimatedCommissionCents: null, status: t.status, delayStatus: t.delayStatus, notes: t.notes,
    ...(server === 'old' ? {} : { allowedActions: ACTIONS(t), technicianNames: [...new Set([t.primaryTechName, ...t.lines.map((l) => l.technicianName)].filter(Boolean))] }) };
}
function detail(t, server) {
  return { ticketId: t.ticketId, ticketNumber: t.ticketNumber, customer: { customerId: t.customerId, fullName: t.customerName, phone: t.customerPhone, isVip: t.isVip, loyaltyPoints: 320, preferredTechName: t.primaryTechName },
    station: t.station, services: t.lines.map((l) => ({ ...l })), primaryTechnician: { technicianId: t.primaryTechId, name: t.primaryTechName }, helperTechnician: null,
    startedAt: t.startedAt ?? undefined, pausedAt: null, estimatedEndAt: t.startedAt ? new Date(new Date(t.startedAt).getTime() + t.est * 60000).toISOString() : null, elapsedMinutes: t.elapsed, estimatedDurationMinutes: t.est,
    delayStatus: t.delayStatus, delayReason: t.delayReason, notes: t.notes, customerVisibleNotes: '', subtotalCents: sum(t.lines), estimatedCommissionCents: null, status: t.status,
    auditSummary: [], addOnSuggestions: ADDONS.map((a, i) => ({ serviceId: id(31000 + i), serviceName: a[0], priceCents: a[1], source: 'service_category' })),
    ...(server === 'old' ? {} : { allowedActions: ACTIONS(t) }) };
}

export function servingDataset(name, server) {
  const m = build(name); const byId = new Map(m.tickets.map((t) => [t.ticketId, t])); const sent = []; const alerts = [];
  const state = (q) => {
    const all = m.tickets; const active = all.filter((t) => ['in_service', 'paused', 'delayed'].includes(t.status));
    let items = all.slice();
    if (q?.get('status')) items = items.filter((t) => t.status === q.get('status'));
    if (q?.get('delayStatus')) items = items.filter((t) => t.delayStatus === q.get('delayStatus') || (q.get('delayStatus') === 'late' && t.status === 'delayed'));
    if (q?.get('serviceCategory')) items = items.filter((t) => t.lines.some((l) => l.category === q.get('serviceCategory')));
    if (q?.get('search')) { const s = q.get('search').toLowerCase(); items = items.filter((t) => [t.customerName, t.primaryTechName, ...t.lines.map((l) => l.serviceName)].some((x) => String(x || '').toLowerCase().includes(s))); }
    const pageSize = Math.min(100, Number(q?.get('pageSize') || 20));
    const empty = all.length === 0; const old = server === 'old';
    const addOnTickets = all.filter((t) => t.status !== 'not_started');
    const durs = active.filter((t) => t.elapsed > 0).map((t) => t.elapsed);
    const order = { Available: 0, 'Finishing Soon': 1, Busy: 2, Break: 3 }; const sorted = [...m.staffAll].sort((a, b) => order[a.status] - order[b.status]);
    const n = (st) => m.staffAll.filter((s) => s.status === st).length;
    const ready = all.filter((t) => t.status === 'completed' || t.status === 'sent_to_service_done');
    const svcOf = (t, add) => sum(t.lines.filter((l) => !!l.isAddOn === add));
    const pot = { inServiceCents: active.filter((t) => !finishing(t)).reduce((a, t) => a + svcOf(t, false), 0), finishingSoonCents: active.filter(finishing).reduce((a, t) => a + svcOf(t, false), 0), addOnsPendingCents: active.reduce((a, t) => a + svcOf(t, true), 0), readyToCompleteCents: ready.reduce((a, t) => a + sum(t.lines), 0) };
    pot.totalCents = pot.inServiceCents + pot.finishingSoonCents + pot.addOnsPendingCents + pot.readyToCompleteCents;
    const byCat = {}; for (const t of active) for (const l of t.lines) if (!l.isAddOn) byCat[l.category] = (byCat[l.category] || 0) + 1;
    const byAdd = {}; for (const t of active) for (const l of t.lines) if (l.isAddOn) byAdd[l.serviceName] = (byAdd[l.serviceName] || 0) + 1;
    const mix = (o) => { const tot = Object.values(o).reduce((a, x) => a + x, 0); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ category: k, label: k, count: c, sharePercent: tot ? Math.round((c / tot) * 1000) / 10 : 0 })); };
    const techPerf = TECH.slice(0, empty ? 0 : 8).map((nm, i) => { const mine = active.filter((t) => t.primaryTechName === nm); return { technicianId: id(9000 + i), name: nm, activeGuests: mine.length, revenueCents: mine.reduce((a, t) => a + sum(t.lines), 0), tipsCents: 0, utilizationPercent: 60 + (i * 7) % 35, avgMinutes: 40 + i * 2, rating: i % 3 === 2 ? null : 4.6 + (i % 3) / 10 }; }).filter((p) => p.activeGuests > 0 || old);
    const delayed = all.filter((t) => t.status === 'delayed').length; const fin = active.filter(finishing).length;
    return {
      kpis: { servingNow: all.filter((t) => t.status === 'in_service').length, activeTickets: active.length, delayedServices: delayed, nearingCompletion: fin,
        averageServiceDurationMinutes: durs.length ? Math.round(durs.reduce((a, d) => a + d, 0) / durs.length) : (old ? 0 : null), totalInServiceSalesCents: active.reduce((a, t) => a + sum(t.lines), 0),
        techniciansInService: new Set(active.map((t) => t.primaryTechId)).size, servicesCompletedToday: ready.length + (empty ? 0 : 6),
        addOnAttachRatePercent: addOnTickets.length ? Math.round((addOnTickets.filter((t) => t.lines.some((l) => l.isAddOn)).length / addOnTickets.length) * 100) : (old ? 0 : null),
        addOnRevenueCents: all.reduce((a, t) => a + svcOf(t, true), 0), customerSatisfactionAvg: empty ? (old ? 0 : null) : 4.7, onTimeCompletionPercent: empty ? (old ? 0 : null) : 86,
        techniciansTotal: m.nTech, ...(old ? {} : { techniciansOnDuty: m.onDuty, readyToStart: all.filter((t) => t.status === 'not_started').length }) },
      kpiTrends: empty ? {} : { active: { deltaPercent: 8, direction: 'up' }, avgTime: { deltaPercent: 3, direction: 'down' }, delayed: { deltaPercent: 10, direction: 'up' } },
      analytics: { serviceTimeTrend: empty ? [] : [9, 10, 11, 12, 13, 14].map((h, i) => ({ hour: h, minutes: 42 + ((i * 7) % 15) })), serviceMix: mix(byCat), addOnMix: mix(byAdd).map(({ label, count, sharePercent }) => ({ label, count, sharePercent })),
        funnel: { started: all.filter((t) => t.startedAt).length, finishing: fin, serviceDone: ready.length, completionRatePercent: all.filter((t) => t.startedAt).length ? Math.round((ready.length / all.filter((t) => t.startedAt).length) * 1000) / 10 : 0 },
        potentialRevenue: old ? { ...pot, addOnsPendingCents: pot.addOnsPendingCents } : pot, potentialRevenueDeltaPercent: null },
      techPerformance: techPerf,
      staff: old ? m.staffAll : sorted.slice(0, 8),
      ...(old ? {} : { staffSummary: { onDuty: m.onDuty, available: n('Available'), finishing: n('Finishing Soon'), busy: n('Busy'), onBreak: n('Break'), shown: Math.min(8, m.staffAll.length), roster: m.nTech },
        stageCounts: { readyToStart: all.filter((t) => t.status === 'not_started').length, inService: active.filter((t) => t.status === 'in_service' && !finishing(t)).length, finishing: fin, ready: ready.length, paused: all.filter((t) => t.status === 'paused').length, delayed } }),
      insights: empty ? [] : [
        ...(delayed ? [{ id: 'overtime', text: `${delayed} services are past the estimated duration`, sub: 'Check the guests and update the expected finish.', action: 'Review Now', route: 'filter:delayed', severity: 'warn', vars: { count: delayed } }] : []),
        { id: 'balance', text: '2 guests waiting on a busy technician', sub: '3 technicians are free — review Auto Balance.', action: 'Balance', route: 'balance', severity: 'info', vars: { count: 2, free: 3 } },
        ...(ready.length ? [{ id: 'ready', text: `${ready.length} guests are ready for Service Done`, sub: 'Hand them off so checkout can start.', action: 'Open', route: '/service-done', severity: 'info', vars: { count: ready.length } }] : []),
        { id: 'vip', text: `${all[0].customerName} should be checked by a manager`, sub: 'Review VIP service quality.', action: 'Open Profile', route: `customer:${all[0].customerId}`, vars: { name: all[0].customerName } },
      ].slice(0, 5),
      tickets: { items: items.slice(0, pageSize).map((t) => row(t, server)), pagination: { page: 1, pageSize, totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) } },
      filters: { statuses: ['not_started', 'in_service', 'paused', 'delayed', 'completed', 'sent_to_service_done'], technicians: TECH, serviceCategories: ['Manicure', 'Pedicure', 'Enhancement', 'Add-on'], stations: [], delayStatuses: ['none', 'warning', 'late', 'critical'] },
      workflowSettings: { allowPauseResume: true, allowServiceEditDuringServing: true, requireNotesBeforeDone: false, allowHelperTechnician: true, autoSendToServiceDone: false, delayAlertMinutes: 10 },
    };
  };
  const nf = { __status: 404, body: { error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found' } } };
  const refuse = (code, message) => ({ __status: 409, body: { error: { code, message } } });
  return {
    sent, alerts,
    route(method, path, q, body) {
      if (method === 'GET' && path === '/pos/serving/state') return state(q);
      if (method === 'GET' && path === '/pos/serving/change-requests/pending') return [];
      if (method === 'GET' && path === '/pos/serving/retail-catalog') return { products: [{ productId: id(40001), name: 'Cuticle Oil', retailPriceCents: 1200 }, { productId: id(40002), name: 'Hand Cream', retailPriceCents: 1800 }] };
      if (method === 'GET' && path === '/pos/serving/balance-suggestions') {
        const rts = m.tickets.filter((t) => t.status === 'not_started').slice(0, 2); const free = m.staffAll.filter((s) => s.status === 'Available').slice(0, 2);
        return { appliesAutomatically: false, suggestions: rts.map((t, i) => free[i] && ({ ticketId: t.ticketId, ticketNumber: t.ticketNumber, customerName: t.customerName, fromTechnicianId: t.primaryTechId, fromTechnicianName: t.primaryTechName, toTechnicianId: free[i].technicianId, toTechnicianName: free[i].name, reason: 'technician_busy' })).filter(Boolean) };
      }
      if (method === 'POST' && path === '/pos/serving/staff-alert') { if (!body?.message) return refuse('MESSAGE_REQUIRED', 'Type the message first'); alerts.push(body); return { ok: true, technicianId: body.technicianId }; }
      let mm;
      if ((mm = /^\/pos\/serving\/tickets\/([^/]+)\/revisions$/.exec(path))) { const t = byId.get(mm[1]); return t ? { ticketId: t.ticketId, currentVersion: t.version, revisions: [] } : nf; }
      if ((mm = /^\/pos\/serving\/tickets\/([^/]+)$/.exec(path)) && method === 'GET') { const t = byId.get(mm[1]); return t ? detail(t, server) : nf; }
      if ((mm = /^\/pos\/serving\/tickets\/([^/]+)\/([a-z-]+)$/.exec(path)) && method === 'POST') {
        const t = byId.get(mm[1]); if (!t) return nf; const act = mm[2];
        if (act === 'start') { if (t.status === 'in_service') return { ...detail(t, server), duplicate: true }; if (!['not_started', 'paused'].includes(t.status)) return refuse('SERVICE_START_STATE_INVALID', 'The service can only start from not started or paused.'); t.status = 'in_service'; t.startedAt = t.startedAt ?? new Date().toISOString(); t.version++; return detail(t, server); }
        if (act === 'pause') { if (t.status !== 'in_service') return refuse('TICKET_NOT_IN_SERVICE', 'Only an in-service ticket can be paused'); t.status = 'paused'; t.version++; return detail(t, server); }
        if (act === 'resume') { if (t.status !== 'paused') return refuse('TICKET_NOT_PAUSED', 'Only a paused ticket can be resumed'); t.status = 'in_service'; t.version++; return detail(t, server); }
        if (act === 'mark-service-done') { if (t.status === 'completed' || t.status === 'sent_to_service_done') return { ...detail(t, server), duplicate: true }; if (!['in_service', 'paused', 'delayed'].includes(t.status)) return refuse('CANNOT_MARK_DONE', 'This service cannot be marked done from its current state.'); t.status = 'completed'; t.version++; return detail(t, server); }
        if (act === 'send-to-service-done') { const dup = t.status === 'sent_to_service_done'; if (t.status === 'not_started') return refuse('CANNOT_SEND_TO_SERVICE_DONE', 'Cannot send to Service Done: NOT_READY'); t.status = 'sent_to_service_done'; if (!dup) sent.push(t.ticketId); return { sent: true, duplicate: dup, serviceDoneTicketId: t.ticketId, idempotencyKey: t.ticketId + ':send' }; }
        if (act === 'add-service') { const a = ADDONS.find((_, i) => id(31000 + i) === body?.serviceId); if (!a) return { __status: 400, body: { error: { code: 'SERVICE_UNKNOWN', message: 'Unknown service' } } }; const lid = 'add-' + (body?.clientRequestId || Math.random()); if (t.lines.some((l) => l.serviceLineId === lid)) return { ...detail(t, server), duplicate: true }; t.lines.push({ serviceLineId: lid, serviceId: body.serviceId, serviceName: a[0], category: 'Add-on', priceCents: a[1], technicianId: body?.technicianId ?? t.primaryTechId, technicianName: t.primaryTechName, status: 'serving', isAddOn: true, estDurationMin: a[2] }); t.est += a[2]; t.version++; return detail(t, server); }
        if (act === 'add-retail') { t.lines.push({ serviceLineId: 'rt-' + t.lines.length, serviceId: '', serviceName: 'Cuticle Oil', priceCents: 1200, status: 'done', isAddOn: false, estDurationMin: 0 }); return { ok: true, productName: 'Cuticle Oil', unitPriceCents: 1200, quantity: 1, lineTotalCents: 1200, stockShortBy: 0 }; }
        if (act === 'notify-customer') return body?.channel === 'sms' ? { channel: 'sms', configured: false, delivered: false, disabledReason: 'SMS provider is not configured yet.' } : { channel: 'app', configured: true, delivered: true };
        if (act === 'assign-technician') { const s = m.staffAll.find((x) => x.technicianId === body?.technicianId); if (!s) return { __status: 400, body: { error: { code: 'TECHNICIAN_NOT_FOUND', message: 'Technician not found in this tenant' } } }; t.primaryTechId = s.technicianId; t.primaryTechName = s.name; t.version++; return detail(t, server); }
        if (['report-delay', 'clear-delay', 'assign-helper', 'update-notes'].includes(act)) { if (act === 'report-delay') { t.status = 'delayed'; t.delayStatus = 'late'; } if (act === 'clear-delay') { t.status = 'in_service'; t.delayStatus = 'none'; } if (act === 'update-notes') t.notes = body?.notes ?? t.notes; t.version++; return detail(t, server); }
      }
      if (method === 'GET' && path === '/pos/technicians/state') return { rows: { items: m.staffAll.slice(0, 40).map((s) => ({ technicianId: s.technicianId, displayName: s.name })) } };
      return undefined;
    },
  };
}
