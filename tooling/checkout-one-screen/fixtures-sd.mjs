// fixtures-sd.mjs — Service Done one-screen datasets (tooling only; Service Done mandate §10, §91–§95). Shapes follow
// GET /pos/service-done/state and /pos/service-done/tickets/:id. Money is integer cents.
//   empty    nothing completed today            normal  8 completed guests, a quiet morning
//   busy     §91: 200 technicians (100 on duty), 30 completed guests — 12 in Review / Confirm, 8 Ready for Checkout,
//            5 Sent to Front Desk, the rest Just Finished — several quality states, multi-technician visits, add-ons,
//            tips, rebookings, AI insights
//   tech200  normal board with the 200-technician roster
//   q100     §93: 100 completion records in the queue
//   long     §94: long guest / technician / service names
// `server=old` (BEFORE measurements): the staff list is every technician (what the server returned before the cap);
// otherwise the fixture answers like the fixed server (8 rows + staffSummary).
const FIRST = ['Ann', 'Bao', 'Chloe', 'Diana', 'Emily', 'Fiona', 'Grace', 'Hana', 'Ivy', 'Jenny', 'Kim', 'Linh', 'Mai', 'Nora', 'Olivia', 'Phuong', 'Quinn', 'Rosa', 'Sara', 'Thao'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vo', 'Smith', 'Johnson', 'Garcia', 'Martinez'];
const TECH = ['Lisa Tran', 'Mary Nguyen', 'Anna Pham', 'Kelly Le', 'Tina Vo', 'Jenny Hoang', 'Amy Dang', 'Vivian Do', 'Helen Bui', 'Cindy Ngo'];
const SVC = [['Gel Manicure', 4500, 'Manicure'], ['Spa Pedicure', 5500, 'Pedicure'], ['Acrylic Full Set', 6500, 'Enhancement'], ['Dip Powder', 5000, 'Enhancement'], ['Deluxe Pedicure', 7500, 'Pedicure']];
const ADD = [['Nail Art (2 nails)', 1500], ['Gel Removal', 1000], ['French Tip', 1000], ['Paraffin Dip', 1200]];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

function ticket(n, stage, o = {}) {
  const svc = SVC[n % SVC.length]; const multi = n % 4 === 1; const hasAdd = n % 3 === 0;
  const tech = o.longNames ? 'Christina-Marie Nguyen-Thompson' : TECH[n % TECH.length]; const tech2 = TECH[(n + 3) % TECH.length];
  const lines = [{ serviceLineId: `${id(2000 + n)}-a`, serviceName: o.longNames ? 'Signature Deluxe Hot-Stone Spa Pedicure with Paraffin' : svc[0], category: svc[2], technicianName: tech, priceCents: svc[1] }];
  if (multi) lines.push({ serviceLineId: `${id(2000 + n)}-b`, serviceName: SVC[(n + 1) % SVC.length][0], category: SVC[(n + 1) % SVC.length][2], technicianName: tech2, priceCents: SVC[(n + 1) % SVC.length][1] });
  if (hasAdd) { const a = ADD[n % ADD.length]; lines.push({ serviceLineId: `${id(2000 + n)}-c`, serviceName: a[0], category: 'Add-on', technicianName: tech, priceCents: a[1], isAddOn: true }); }
  const sub = lines.reduce((a, l) => a + l.priceCents, 0); const tip = n % 5 === 4 ? 0 : Math.round(sub * 0.18);
  const quality = stage === 'review' ? (n % 3 === 0 ? 'issue_found' : 'needs_review') : stage === 'just' ? 'pending' : 'approved';
  const checkoutStatus = stage === 'ready' ? 'ready_for_checkout' : stage === 'sent' ? 'sent_to_checkout' : 'not_ready';
  const status = stage === 'sent' ? 'sent_to_checkout' : stage === 'ready' ? 'ready_for_checkout' : 'completed';
  const name = o.longNames ? `${FIRST[n % FIRST.length]}-Alexandra ${LAST[n % LAST.length]}-Washington-Montgomery` : `${FIRST[n % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`;
  const row = {
    ticketId: id(1000 + n), ticketNumber: '#' + (3040 + n), customerId: id(5000 + n), customerName: name, customerPhone: `(856) 555-${String(1000 + n).slice(-4)}`, isVip: n % 9 === 0,
    serviceCount: lines.length, serviceNames: lines.filter((l) => !l.isAddOn).map((l) => l.serviceName), addOnsLabel: lines.filter((l) => l.isAddOn).map((l) => l.serviceName).join(', ') || undefined,
    primaryTechnicianId: id(9000 + (n % TECH.length)), primaryTechnicianName: tech, helperTechnicianName: multi ? tech2 : undefined,
    startedAt: iso(60 + n * 4), completedAt: iso(2 + n * 4), durationMinutes: 40 + (n % 5) * 8, subtotalCents: sub, tipCents: tip,
    qualityStatus: quality, checkoutStatus, customerNotifiedAt: null, notes: '', status,
  };
  const detail = {
    ticketId: row.ticketId, ticketNumber: row.ticketNumber, customer: { customerId: row.customerId, fullName: name, phone: row.customerPhone, isVip: row.isVip, loyaltyPoints: 120 + n * 9, visitCount: 2 + (n % 6), totalSpendCents: 25000 + n * 1300 },
    services: lines, primaryTechnician: { technicianId: row.primaryTechnicianId, name: tech }, helperTechnician: multi ? { technicianId: id(9100 + n), name: tech2 } : null,
    startedAt: row.startedAt, completedAt: row.completedAt, durationMinutes: row.durationMinutes,
    qualityChecklist: { allServicesCompleted: true, customerReady: true, servicesReviewed: quality === 'approved', noOpenIssues: quality !== 'issue_found', notesCompleted: false },
    qualityStatus: quality, notes: quality === 'issue_found' ? 'Guest noticed a chip on the left ring finger.' : '', customerVisibleNotes: '', customerNotifiedAt: null,
    subtotalCents: sub, tipCents: tip, estimatedCommissionCents: null, checkoutStatus, status, serviceDoneLocked: stage === 'sent', rebooking: n % 2 ? { label: 'Rebook in 3 weeks', window: 'Nov 15 – Nov 22' } : null,
  };
  return { row, detail };
}

function board(name, server) {
  const plan = { empty: [], normal: ['just', 'just', 'review', 'ready', 'ready', 'sent', 'just', 'review'] }[name];
  let stages = plan;
  if (!stages) {
    if (name === 'busy') stages = [...Array(5).fill('just'), ...Array(12).fill('review'), ...Array(8).fill('ready'), ...Array(5).fill('sent')];
    else if (name === 'q100') stages = Array.from({ length: 100 }, (_, i) => ['just', 'review', 'ready', 'sent'][i % 4]);
    else stages = ['just', 'just', 'review', 'ready', 'ready', 'sent', 'just', 'review'];
  }
  const ts = stages.map((st, n) => ticket(n, st, { longNames: name === 'long' }));
  const nTech = name === 'busy' || name === 'tech200' ? 200 : 10;
  const onDuty = name === 'busy' || name === 'tech200' ? 100 : 8;
  const ST = ['Available', 'Busy', 'Finishing Soon', 'Break'];
  const staffAll = Array.from({ length: onDuty }, (_, i) => ({ technicianId: id(9000 + i), name: i < TECH.length ? TECH[i] : `Technician ${i + 1}`, specialty: ['Manicure', 'Pedicure', 'Enhancement'][i % 3], currentLoadBusy: i % 4 === 1 ? 1 : 0, status: ST[i % 4], nextAvailable: ST[i % 4] === 'Available' ? 'Now' : ST[i % 4] === 'Finishing Soon' ? 'Soon' : '—' }));
  const order = { Available: 0, 'Finishing Soon': 1, Busy: 2, Break: 3 };
  const staffSorted = [...staffAll].sort((a, b) => order[a.status] - order[b.status]);
  const count = (st) => staffAll.filter((s) => s.status === st).length;
  const rows = ts.map((t) => t.row);
  const review = rows.filter((r) => r.qualityStatus === 'pending' || r.qualityStatus === 'needs_review').length;
  const ready = rows.filter((r) => r.checkoutStatus === 'ready_for_checkout').length; const sent = rows.filter((r) => r.checkoutStatus === 'sent_to_checkout').length;
  const notSent = rows.filter((r) => r.checkoutStatus !== 'sent_to_checkout');
  const svcC = notSent.reduce((a, r) => a + ts.find((t) => t.row === r).detail.services.filter((l) => !l.isAddOn).reduce((x, l) => x + l.priceCents, 0), 0);
  const addC = notSent.reduce((a, r) => a + ts.find((t) => t.row === r).detail.services.filter((l) => l.isAddOn).reduce((x, l) => x + l.priceCents, 0), 0);
  const tipsC = notSent.reduce((a, r) => a + (r.tipCents || 0), 0);
  const techPerf = TECH.slice(0, Math.min(TECH.length, rows.length ? 8 : 0)).map((n, i) => ({ technicianId: id(9000 + i), name: n, completedGuests: rows.filter((r) => r.primaryTechnicianName === n).length, revenueCents: rows.filter((r) => r.primaryTechnicianName === n).reduce((a, r) => a + r.subtotalCents, 0), tipsCents: rows.filter((r) => r.primaryTechnicianName === n).reduce((a, r) => a + (r.tipCents || 0), 0), avgMinutes: 48, rating: i % 3 === 2 ? null : 4.6 + (i % 3) / 10 }));
  const issues = rows.filter((r) => r.qualityStatus === 'issue_found').length;
  const empty = rows.length === 0;
  const state = {
    kpis: { completedServicesToday: rows.length, ticketsReadyForReview: review, ticketsReadyForCheckout: ready, qualityIssuesCount: issues, reopenedServicesToday: 0, averageServiceDurationMinutes: empty ? 0 : 52, estimatedSalesCents: svcC + addC, estimatedCommissionCents: null, addOnRevenueCents: addC, averageTurnaroundSeconds: empty ? 0 : 420, customerSatisfactionAvg: empty ? null : 4.7, customerSatisfactionCount: empty ? 0 : 6, tipsCapturedCents: empty ? 0 : 18640, rebookingRatePercent: empty ? null : 38, rebookingEligible: empty ? 0 : 13, completionAccuracyPercent: empty ? null : Math.round(((rows.length - issues) / rows.length) * 100) },
    kpiTrends: empty ? {} : { completed: { deltaPercent: 12, direction: 'up' }, duration: { deltaPercent: 4, direction: 'down' } },
    analytics: {
      completionTrend: empty ? [] : [9, 10, 11, 12, 13].map((h, i) => ({ hour: h, count: 1 + ((i * 3) % 5) })),
      serviceMix: empty ? [] : [{ category: 'Manicure', sharePercent: 40, count: 12 }, { category: 'Pedicure', sharePercent: 35, count: 10 }, { category: 'Enhancement', sharePercent: 25, count: 8 }],
      addOnMix: empty ? [] : [{ label: 'Nail Art', sharePercent: 50, count: 4 }, { label: 'Gel Removal', sharePercent: 30, count: 3 }, { label: 'French Tip', sharePercent: 20, count: 2 }],
      funnel: { completed: rows.length, inReview: review, readyForCheckout: ready, sentToFrontDesk: sent },
      potentialRevenue: { serviceCents: svcC, addOnCents: addC, tipsEstCents: tipsC, taxesEstCents: 0, totalCents: svcC + addC + tipsC },
      completionTrendDeltaPercent: null, potentialRevenueDeltaPercent: null,
    },
    techPerformance: techPerf,
    staff: server === 'old' ? staffAll : staffSorted.slice(0, 8),
    ...(server === 'old' ? {} : { staffSummary: { total: staffAll.length, onDuty, available: count('Available'), finishing: count('Finishing Soon'), busy: count('Busy'), onBreak: count('Break'), shown: Math.min(8, staffAll.length), roster: nTech } }),
    insights: empty ? [] : [
      { id: 'delayed', text: `${ready} completed guests ready for checkout`, action: 'Review Now', route: '/service-done', vars: { count: ready } },
      ...(issues ? [{ id: 'quality', text: `${issues} quality issue${issues === 1 ? '' : 's'} holding checkout`, severity: 'warn', vars: { count: issues } }] : []),
      { id: 'vip', text: `${rows[0].customerName} is a VIP guest`, sub: 'Prompt rebooking before checkout.', action: 'Open Profile', route: '/customers', vars: { name: rows[0].customerName } },
    ],
    tickets: { items: rows.slice(0, server === 'old' ? 20 : 100), pagination: { page: 1, pageSize: 100, totalItems: rows.length, totalPages: 1 } },
    filters: { statuses: ['completed', 'ready_for_checkout', 'sent_to_checkout', 'reopened'], technicians: TECH, serviceCategories: ['Manicure', 'Pedicure', 'Enhancement', 'Add-on'], qualityStatuses: ['pending', 'approved', 'issue_found', 'needs_review'], stations: [] },
    workflowSettings: { requireQualityCheckBeforeCheckout: true, requireServiceNotes: false, allowReopenService: true, managerApprovalRequiredForReopen: false, autoFlowToCheckoutEnabled: false, notifyCustomerWhenReady: true },
  };
  return { state, ts };
}

export function serviceDoneDataset(name, server) {
  const b = board(name, server);
  const byId = new Map(b.ts.map((t) => [t.row.ticketId, t]));
  const moved = new Set();
  return {
    route(method, path, q) {
      if (method === 'GET' && path === '/pos/service-done/state') {
        // the quality / status / search filters are server-side (§70–§72): the fixture applies them like the server
        let items = b.state.tickets.items;
        if (q?.get('qualityStatus')) items = items.filter((r) => r.qualityStatus === q.get('qualityStatus'));
        if (q?.get('status')) items = items.filter((r) => r.status === q.get('status'));
        if (q?.get('search')) { const s = q.get('search').toLowerCase(); items = items.filter((r) => [r.customerName, r.primaryTechnicianName, ...r.serviceNames].some((x) => String(x || '').toLowerCase().includes(s))); }
        return { ...b.state, tickets: { ...b.state.tickets, items, pagination: { ...b.state.tickets.pagination, totalItems: items.length } } };
      }
      let m;
      if ((m = /^\/pos\/service-done\/tickets\/([^/]+)$/.exec(path)) && method === 'GET') { const t = byId.get(m[1]); return t ? t.detail : { __status: 404, body: { error: { code: 'TICKET_NOT_FOUND' } } }; }
      if ((m = /^\/pos\/service-done\/tickets\/([^/]+)\/send-to-checkout$/.exec(path)) && method === 'POST') {
        const t = byId.get(m[1]); if (!t) return { __status: 404, body: { error: { code: 'TICKET_NOT_FOUND' } } };
        if (t.row.qualityStatus !== 'approved') return { __status: 400, body: { error: { code: 'CANNOT_SEND_TO_CHECKOUT', message: 'Cannot send to checkout: QUALITY_NOT_APPROVED' } } };
        const dup = moved.has(m[1]) || t.row.checkoutStatus === 'sent_to_checkout'; moved.add(m[1]);
        return { sent: true, duplicate: dup, checkoutTicketId: m[1], idempotencyKey: m[1] + ':send_to_checkout:' + t.row.subtotalCents };
      }
      if ((m = /^\/pos\/service-done\/tickets\/([^/]+)\/(quality-check|reopen-service|notify-customer|update-notes|mark-ready-for-checkout)$/.exec(path)) && method === 'POST') {
        const t = byId.get(m[1]); if (!t) return { __status: 404, body: { error: { code: 'TICKET_NOT_FOUND' } } };
        if (m[2] === 'notify-customer') return { channel: 'sms', configured: false, disabledReason: 'SMS provider is not configured yet.' };
        return t.detail;
      }
      if (path.startsWith('/pos/memberships') || /membership/.test(path)) return { memberships: [], items: [], eligible: false };
      return undefined;
    },
  };
}
