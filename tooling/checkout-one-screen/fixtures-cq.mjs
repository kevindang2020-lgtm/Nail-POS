// fixtures-cq.mjs — Customer Queue one-screen datasets (tooling only; Customer Queue mandate Oct 28 2026 §18, §63–§67).
// Shapes follow GET /pos/queue/state and /pos/queue/items/:id. Money is integer cents. STATEFUL: assign / start-service /
// move-to-tech-queue / update (notes) / update-priority / cancel / notify-customer / auto-balance apply mutate the model
// and the next GET reflects it; every write is also logged by server.mjs.
//   empty   nobody waiting                    normal  10 guests across every stage
//   busy    §63: 100 active records — 50 waiting, 20 called (ready for assignment), 15 assigned, 10 ready for service,
//           5 in service; 5 VIP / urgent; 200 technicians, 100 on duty
//   tech200 normal queue with the 200-technician roster      q250  §67: 250 active records      long  §66: long names
// `server=old` (BEFORE): the server as it was — staff = every technician on duty, decorative 0 KPIs, no flow / priority
// projection, no waitLevel; otherwise it answers like the fixed server.
const FIRST = ['Ann', 'Bao', 'Chloe', 'Diana', 'Emily', 'Fiona', 'Grace', 'Hana', 'Ivy', 'Jenny', 'Kim', 'Linh', 'Mai', 'Nora', 'Olivia', 'Phuong', 'Quinn', 'Rosa', 'Sara', 'Thao'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vo', 'Smith', 'Johnson', 'Garcia', 'Martinez'];
const TECH = ['Lisa Tran', 'Mary Nguyen', 'Anna Pham', 'Kelly Le', 'Tina Vo', 'Jenny Hoang', 'Amy Dang', 'Vivian Do', 'Helen Bui', 'Cindy Ngo'];
const SVC = [['Gel Manicure', 4500, 45], ['Spa Pedicure', 5500, 55], ['Acrylic Full Set', 6500, 75], ['Dip Powder', 5000, 60], ['Deluxe Pedicure', 7500, 65]];
const SRC = ['walk_in', 'appointment', 'walk_in', 'online', 'ai', 'walk_in'];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RANK = { urgent: 0, vip: 1, high: 2, normal: 3 };   // rankQueue (queue.dto.ts): urgent 3 > vip 2 > high 1 > normal
const AVG_SVC = 60;

function build(name) {
  const plans = {
    empty: [], normal: ['waiting', 'waiting', 'waiting', 'called', 'called', 'assigned', 'assigned', 'ready_for_tech', 'in_service', 'waiting'],
    busy: [...Array(50).fill('waiting'), ...Array(20).fill('called'), ...Array(15).fill('assigned'), ...Array(10).fill('ready_for_tech'), ...Array(5).fill('in_service')],
    q250: Array.from({ length: 250 }, (_, i) => ['waiting', 'waiting', 'called', 'assigned', 'ready_for_tech'][i % 5]),
  };
  const plan = plans[name] ?? plans.normal; const long = name === 'long';
  const nTech = name === 'busy' || name === 'tech200' ? 200 : 10; const onDuty = name === 'busy' || name === 'tech200' ? 100 : 8;
  const items = plan.map((st, n) => {
    const s = SVC[n % SVC.length]; const two = n % 4 === 2;
    const services = [{ serviceId: id(30000 + (n % 5)), serviceName: long ? 'Signature Deluxe Hot-Stone Spa Pedicure with Paraffin' : s[0], estimatedDurationMinutes: s[2], priceCents: s[1] }];
    if (two) services.push({ serviceId: id(31000), serviceName: 'Nail Art (2 nails)', estimatedDurationMinutes: 15, priceCents: 1500, isAddon: true, parentServiceId: services[0].serviceId });
    const assigned = ['assigned', 'ready_for_tech', 'in_service'].includes(st);
    const priority = n % 20 === 3 ? 'vip' : n % 20 === 7 ? 'urgent' : n % 11 === 5 ? 'high' : 'normal';
    const wait = 2 + ((n * 7) % 58);
    return { queueItemId: id(1000 + n), customerId: id(5000 + n), customerName: long ? `${FIRST[n % FIRST.length]}-Alexandra ${LAST[n % LAST.length]}-Washington-Montgomery` : `${FIRST[(n * 7) % FIRST.length]} ${LAST[(n * 3 + Math.floor(n / 20)) % LAST.length]}`,
      customerPhone: `(856) 555-${String(1000 + n).slice(-4)}`, isVip: priority === 'vip', source: SRC[n % SRC.length], requestedServices: services, serviceCount: services.length, priority, status: st,
      requestedTechnicianName: n % 3 === 0 ? (long ? 'Christina-Marie Nguyen-Thompson' : TECH[(n + 2) % TECH.length]) : undefined,
      assignedTechnicianId: assigned ? id(9000 + (n % TECH.length)) : null, assignedTechnicianName: assigned ? TECH[n % TECH.length] : null,
      bestMatchTechnicianName: !assigned ? TECH[(n + 1) % TECH.length] : undefined, bestMatchTechnicianId: !assigned ? id(9000 + ((n + 1) % TECH.length)) : undefined,
      checkedInAt: new Date(Date.now() - wait * 60000).toISOString(), actualWaitMinutes: wait, version: 1, position: null, groupId: null, lock: null, notes: n % 6 === 0 ? 'Prefers short almond shape.' : '' };
  });
  const ST = ['available', 'in_service', 'in_service', 'on_break'];
  const sig = Array.from({ length: onDuty }, (_, i) => ({ technicianId: id(9000 + i), name: i < TECH.length ? TECH[i] : `Technician ${i + 1}`, status: ST[i % 4], availableInMinutes: ST[i % 4] === 'in_service' ? (i % 8 === 1 ? 8 : 35) : 0, onBreak: ST[i % 4] === 'on_break', activeAssignments: ST[i % 4] === 'in_service' ? 1 : 0, shiftEndsInMinutes: 240, nextAppointmentInMinutes: null }));
  return { items, sig, nTech, onDuty };
}

const ACTIVE = ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue', 'in_service'];
const sum = (q) => q.requestedServices.reduce((a, s) => a + (s.priceOverrideCents ?? s.priceCents ?? 0), 0);

export function customerQueueDataset(name, server) {
  const m = build(name); const byId = new Map(m.items.map((q) => [q.queueItemId, q])); const notes = []; const walkIns = new Map(); const walkInLog = []; const old = server === 'old';
  const row = (q) => ({ ...q, ...(old ? {} : { waitLevel: ['waiting', 'called', 'assigned'].includes(q.status) && q.actualWaitMinutes > AVG_SVC ? 'delayed' : 'normal' }) });   // the server's rule (queue-floor.ts)
  const state = (qs) => {
    // the server's default list / KPI population: waiting · called · assigned · ready_for_tech (the board adds moved_to_tech_queue)
    const active = m.items.filter((q) => ACTIVE.includes(q.status) && q.status !== 'in_service');
    const listPop = active.filter((q) => q.status !== 'moved_to_tech_queue'); let items = qs?.get('status') === 'all' ? active.slice() : listPop.slice();
    if (qs?.get('status') && qs.get('status') !== 'all') items = m.items.filter((q) => q.status === qs.get('status'));
    if (qs?.get('source')) items = items.filter((q) => q.source === qs.get('source'));
    if (qs?.get('search')) { const s = qs.get('search').toLowerCase(); items = items.filter((q) => [q.customerName, q.customerPhone, ...q.requestedServices.map((x) => x.serviceName)].some((x) => String(x || '').toLowerCase().includes(s))); }
    const pageSize = Math.min(100, Number(qs?.get('pageSize') || 20)); const page = Math.max(1, Number(qs?.get('page') || 1));
    const waiting = listPop; const waits = waiting.map((q) => q.actualWaitMinutes);   // KPIs: the whole population, never the filtered page (§14)
    const empty = active.length === 0;
    // the server's projection (queue-floor.ts): canonical status columns, counts + the first 3 by arrival
    const STAGES = ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue'];
    const fc = Object.fromEntries(STAGES.map((st) => [st, 0])); const ftop = Object.fromEntries(STAGES.map((st) => [st, []]));
    for (const q of active.slice().sort((x, y) => y.actualWaitMinutes - x.actualWaitMinutes)) if (q.status in fc) { fc[q.status]++; if (ftop[q.status].length < 3) ftop[q.status].push(row(q)); }
    const pc = { urgent: 0, vip: 0, high: 0, normal: 0 }; for (const q of waiting) pc[q.priority]++;
    const byPrio = waiting.filter((q) => ['waiting', 'called', 'assigned'].includes(q.status)).sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.actualWaitMinutes - a.actualWaitMinutes).slice(0, 8);
    const order = { Available: 0, 'Finishing Soon': 1, Busy: 2, Break: 3 };
    const staffAll = m.sig.map((t) => ({ technicianId: t.technicianId, name: t.name, specialty: ['Manicure', 'Pedicure', 'Enhancement'][Number(t.technicianId.slice(-2)) % 3], currentLoad: t.activeAssignments, nextAvailable: t.status === 'available' ? 'Now' : t.status === 'on_break' ? '—' : `${t.availableInMinutes} min`, status: t.status === 'available' ? 'Available' : t.status === 'on_break' ? 'Break' : t.availableInMinutes <= 15 ? 'Finishing Soon' : 'Busy' }));
    const n = (st) => staffAll.filter((s) => s.status === st).length;
    const svcCount = {}; for (const q of waiting) for (const s of q.requestedServices) if (!s.isAddon) svcCount[s.serviceName] = (svcCount[s.serviceName] || 0) + 1;
    const svcTot = Object.values(svcCount).reduce((a, x) => a + x, 0);
    const potBy = {}; let pot = 0; for (const q of waiting) for (const s of q.requestedServices) { const c = s.priceOverrideCents ?? s.priceCents ?? 0; pot += c; potBy[s.serviceName] = (potBy[s.serviceName] || 0) + c; }
    const src = {}; for (const q of waiting) src[q.source] = (src[q.source] || 0) + 1;
    const SRC_L = { walk_in: 'Walk-In', appointment: 'Appointment', online: 'App', ai: 'AI Receptionist' };
    const mix = (o) => { const t = Object.values(o).reduce((a, x) => a + x, 0); return Object.entries(o).map(([label, count]) => ({ label, count, sharePercent: t ? Math.round((count / t) * 100) : 0 })); };
    const unassigned = waiting.filter((q) => !q.assignedTechnicianId && ['waiting', 'called'].includes(q.status));
    const longest = waiting.slice().sort((a, b) => b.actualWaitMinutes - a.actualWaitMinutes)[0];
    const vip = waiting.filter((q) => q.priority === 'vip' || q.isVip).sort((a, b) => b.actualWaitMinutes - a.actualWaitMinutes)[0];
    return {
      kpis: { waitingGuests: waiting.length, averageWaitMinutes: waits.length ? Math.round(waits.reduce((a, w) => a + w, 0) / waits.length) : (old ? 0 : null), longestWaitMinutes: waits.length ? Math.max(...waits) : 0,
        vipWaiting: waiting.filter((q) => q.isVip || q.priority === 'vip').length, appointmentsWaiting: waiting.filter((q) => q.source === 'appointment').length, walkInsWaiting: waiting.filter((q) => q.source === 'walk_in').length,
        readyForTech: active.filter((q) => q.status === 'ready_for_tech').length, assignedTechnicians: new Set(waiting.filter((q) => q.assignedTechnicianId).map((q) => q.assignedTechnicianId)).size, delayedQueueItems: waiting.filter((q) => q.actualWaitMinutes > AVG_SVC).length,
        readyForAssignment: unassigned.length, estQueueRevenueCents: pot, readyForService: active.filter((q) => ['ready_for_tech', 'assigned'].includes(q.status)).length,
        noShowRisk: waiting.filter((q) => q.source === 'appointment' && q.actualWaitMinutes > AVG_SVC).length, returnRatePercent: empty ? (old ? 0 : null) : 62 },
      kpiTrends: empty ? {} : { waiting: { deltaPercent: 12, direction: 'up' }, avgWait: { deltaPercent: 5, direction: 'down' } },
      analytics: { queueTrend: empty ? [] : [9, 10, 11, 12, 13, 14].map((h, i) => ({ hour: h, count: 2 + ((i * 5) % 9) })),
        customerTypeMix: empty ? [] : [{ label: 'Returning', count: Math.round(waiting.length * 0.6), sharePercent: 60 }, { label: 'New', count: Math.round(waiting.length * 0.3), sharePercent: 30 }, { label: 'VIP', count: Math.max(1, Math.round(waiting.length * 0.1)), sharePercent: 10 }],
        visitSourceMix: mix(Object.fromEntries(Object.entries(src).map(([k, v]) => [SRC_L[k] || k, v]))),
        topWaitingServices: Object.entries(svcCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([service, count]) => ({ service, count, sharePercent: svcTot ? Math.round((count / svcTot) * 100) : 0 })),
        conversion: { percent: empty ? null : 74, goalPercent: 70, deltaPercent: empty ? null : 3 },
        potentialRevenueByService: Object.entries(potBy).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([service, revenueCents]) => ({ service, revenueCents })), potentialRevenueTotalCents: pot, potentialRevenueDeltaPercent: null },
      staff: old ? staffAll : staffAll.slice().sort((a, b) => order[a.status] - order[b.status]).slice(0, 8),
      ...(old ? {} : { staffSummary: { onDuty: m.onDuty, available: n('Available'), finishing: n('Finishing Soon'), busy: n('Busy'), onBreak: n('Break'), shown: Math.min(8, staffAll.length), roster: m.nTech },
        flow: { counts: fc, top: ftop }, priorityCounts: pc, waitingByPriority: byPrio.map(row) }),
      insights: empty ? [] : [
        ...(longest ? [{ id: 'longWait', text: `${longest.customerName} has waited ${longest.actualWaitMinutes} min`, action: 'Open', route: `guest:${longest.queueItemId}`, severity: 'warn', vars: { name: longest.customerName, minutes: longest.actualWaitMinutes } }] : []),
        ...(vip ? [{ id: 'vip', text: `${vip.customerName} has waited ${vip.actualWaitMinutes} min`, sub: 'VIP guest. Recommend priority assignment.', action: 'Assign VIP Now', route: `assign:${vip.queueItemId}`, severity: 'warn', vars: { name: vip.customerName, minutes: vip.actualWaitMinutes } }] : []),
        ...(unassigned.length ? [{ id: 'unassigned', text: `${unassigned.length} guests waiting for a technician`, action: 'Auto Balance Queue', route: 'balance', vars: { count: unassigned.length, free: n('Available') } }] : []),
        { id: 'peak', text: 'Peak arrival window: 11:00 AM - 1:00 PM', sub: 'High volume detected. Consider adding staff.', vars: { fromHour: 11, toHour: 13 } },
      ].slice(0, 5),
      queue: { items: items.slice((page - 1) * pageSize, page * pageSize).map(row), pagination: { page, pageSize, totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) } },
      filters: { statuses: ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue', 'in_service', 'cancelled', 'removed'], sources: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'], technicians: TECH, serviceCategories: ['Manicure', 'Pedicure', 'Enhancement'], priorityLevels: ['normal', 'high', 'vip', 'urgent'], stations: [] },
      workflowSettings: { waitEstimateBasis: 'available_techs', vipPriorityEnabled: true, allowManualPriority: true, allowMoveToServingWithoutTech: false, notifyCustomerWhenReady: true },
    };
  };
  const nf = { __status: 404, body: { error: { code: 'QUEUE_ITEM_NOT_FOUND', message: 'Queue item not found' } } };
  const refuse = (code, message, status = 409) => ({ __status: status, body: { code, message } });
  return {
    notes, walkInLog,
    route(method, path, qs, body) {
      if (method === 'GET' && path === '/pos/queue/state') return state(qs);
      if (method === 'GET' && path === '/pos/queue/groups') return [];
      if (method === 'GET' && path === '/pos/queue/technicians/availability') return m.sig.slice(0, 40);
      if (method === 'POST' && path === '/pos/queue/auto-balance/preview') {
        const un = m.items.filter((q) => !q.assignedTechnicianId && ['waiting', 'called'].includes(q.status)).slice(0, 3); const free = m.sig.filter((t) => t.status === 'available');
        return { proposals: un.map((q, i) => free[i] && { queueItemId: q.queueItemId, customerName: q.customerName, technicianId: free[i].technicianId, technicianName: free[i].name, reason: 'Next fair turn · approved for the service', addressesWaitMinutes: q.actualWaitMinutes }).filter(Boolean), unassignable: [], summary: { proposed: Math.min(un.length, free.length), guestsConsidered: un.length, totalWaitAddressedMinutes: 0 } };
      }
      if (method === 'POST' && path === '/pos/queue/auto-balance/apply') { let applied = 0; for (const p of body?.proposals || []) { const q = byId.get(p.queueItemId); if (q && !q.assignedTechnicianId) { q.assignedTechnicianId = p.technicianId; q.assignedTechnicianName = m.sig.find((t) => t.technicianId === p.technicianId)?.name; q.status = 'assigned'; q.version++; applied++; } } return { applied, failures: [] }; }
      if (method === 'GET' && path === '/pos/check-in/state') return { services: [...SVC.map((s, i) => ({ serviceId: id(30000 + i), name: s[0], durationMinutes: s[2], priceCents: s[1] })), { serviceId: id(31000), name: 'Nail Art (2 nails)', durationMinutes: 15, priceCents: 1500, isAddon: true }, { serviceId: id(31001), name: 'Paraffin Treatment', durationMinutes: 10, priceCents: 1200, isAddon: true }], technicians: [] };
      if (method === 'GET' && path === '/pos/booking/technicians') {   // the server-paged technician picker (12 a page)
        const pg = Number(qs?.get('page') || 1); const q = (qs?.get('search') || '').toLowerCase();
        const all = m.sig.map((t, i) => ({ technicianId: t.technicianId, name: t.name, rosterNumber: i + 1, avatarUrl: null, available: t.status === 'available', workingToday: true, skills: [], rating: null, reviewCount: 0 })).filter((t) => !q || t.name.toLowerCase().includes(q));
        return { date: '2026-10-28', technicians: all.slice((pg - 1) * 12, pg * 12), total: all.length, totalAll: all.length, workingCount: all.length, page: pg, pageSize: 12, totalPages: Math.max(1, Math.ceil(all.length / 12)) };
      }
      if (method === 'GET' && path === '/pos/check-in/customers/search') return [{ customerId: id(5900), fullName: 'Walk-In Guest Test', phone: '(856) 555-0199', totalVisits: 2 }];
      if (method === 'POST' && path === '/pos/check-in/walk-in') {   // §53: one visit + one active entry per idempotency key
        const key = body?.idempotencyKey; const prev = key && walkIns.get(key); if (prev) return { ...row(prev), duplicate: true };
        const n = m.items.length; const s = SVC.find((_, i) => id(30000 + i) === body?.serviceIds?.[0]) || SVC[0];
        const q = { queueItemId: id(1000 + n), customerId: body?.customerId || id(5000 + n), customerName: body?.customerName || 'Walk-In', customerPhone: body?.customerPhone, isVip: false, source: 'walk_in',
          requestedServices: [{ serviceId: body?.serviceIds?.[0] || id(30000), serviceName: s[0], estimatedDurationMinutes: s[2], priceCents: s[1] }], serviceCount: 1, priority: 'normal', status: 'waiting',
          assignedTechnicianId: null, assignedTechnicianName: null, checkedInAt: new Date().toISOString(), actualWaitMinutes: 0, version: 1, position: null, groupId: null, lock: null, notes: '' };
        m.items.push(q); byId.set(q.queueItemId, q); if (key) walkIns.set(key, q); walkInLog.push(key || null); return { ...row(q), duplicate: false };
      }
      let mm;
      if ((mm = /^\/pos\/queue\/items\/([^/]+)\/history$/.exec(path))) return { queueItemId: mm[1], history: [] };
      if ((mm = /^\/pos\/queue\/items\/([^/]+)$/.exec(path))) {
        const q = byId.get(mm[1]); if (!q) return nf;
        if (method === 'GET') return { ...row(q), email: null, loyaltyPoints: 240, visitCount: 6, totalSpendCents: 41200, birthday: null, preferredTechName: q.requestedTechnicianName, allergies: '', auditSummary: [] };
        if (method === 'PATCH') { if (body?.notes !== undefined) { q.notes = body.notes; notes.push({ queueItemId: q.queueItemId, notes: body.notes }); } return { ...row(q), auditSummary: [] }; }
      }
      if ((mm = /^\/pos\/queue\/items\/([^/]+)\/([a-z-]+)$/.exec(path)) && method === 'POST') {
        const q = byId.get(mm[1]); if (!q) return nf; const act = mm[2];
        if (act === 'assign-technician') {
          if (body?.expectedVersion != null && body.expectedVersion !== q.version) return { __status: 409, body: { code: 'VERSION_CONFLICT', message: 'This guest was just assigned or changed on another device. The queue has been refreshed.', currentTechnicianId: q.assignedTechnicianId, currentVersion: q.version } };
          const t = m.sig.find((x) => x.technicianId === body?.technicianId); q.assignedTechnicianId = body?.technicianId; q.assignedTechnicianName = t?.name || TECH[0]; q.status = 'assigned'; q.version++; return { ...row(q), auditSummary: [] };
        }
        if (act === 'start-service' || act === 'move-to-serving') { if (q.status === 'in_service') return { moved: true, duplicate: true, servingTicketId: q.queueItemId, idempotencyKey: q.queueItemId + ':move_to_serving' }; if (!q.assignedTechnicianId) return refuse('CANNOT_START_SERVICE', 'Cannot start service: TECHNICIAN_REQUIRED', 400); q.status = 'in_service'; q.version++; return { moved: true, duplicate: false, servingTicketId: q.queueItemId, idempotencyKey: q.queueItemId + ':move_to_serving' }; }
        if (act === 'move-to-tech-queue') { const dup = q.status === 'moved_to_tech_queue'; q.status = 'moved_to_tech_queue'; return { moved: true, duplicate: dup, techQueueItemId: q.queueItemId, idempotencyKey: q.queueItemId + ':move_to_tech_queue' }; }
        if (act === 'notify-customer') return body?.channel === 'sms' ? { channel: 'sms', configured: false, disabledReason: 'Customer notification is not configured yet.' } : body?.channel === 'app' ? { channel: 'app', configured: true, delivered: q.source !== 'walk_in' } : { channel: body?.channel || 'front_desk', configured: true };   // the fixture's walk-ins have no Customer App
        if (act === 'update-priority') { if (body?.priority && body.priority !== 'normal' && body.priority !== q.priority && !String(body?.reason || '').trim()) return refuse('PRIORITY_REASON_REQUIRED', 'Say why this guest moves ahead of the line.', 400); q.priority = body?.priority || q.priority; q.version++; return { ...row(q), auditSummary: [] }; }
        if (act === 'cancel') { q.status = 'cancelled'; q.version++; return { ...row(q), auditSummary: [] }; }
        if (act === 'update-services') { const last = body?.serviceIds?.at(-1); const extra = { serviceId: last, serviceName: last === id(31001) ? 'Paraffin Treatment' : 'Nail Art (2 nails)', estimatedDurationMinutes: 15, priceCents: 1500, isAddon: true }; if (!q.requestedServices.some((s) => s.serviceId === extra.serviceId)) q.requestedServices.push(extra); q.serviceCount = q.requestedServices.length; q.version++; return { ...row(q), auditSummary: [] }; }
        if (['unassign-technician', 'lock', 'unlock', 'call-next', 'change-requested-technician'].includes(act)) { if (act === 'unassign-technician') { q.assignedTechnicianId = null; q.assignedTechnicianName = null; q.status = 'waiting'; } if (act === 'call-next') q.status = 'called'; q.version++; return { ...row(q), auditSummary: [] }; }
      }
      if (method === 'GET' && path === '/pos/technicians/state') return { rows: { items: m.sig.slice(0, 40).map((s) => ({ technicianId: s.technicianId, displayName: s.name })) } };
      return undefined;
    },
  };
}
