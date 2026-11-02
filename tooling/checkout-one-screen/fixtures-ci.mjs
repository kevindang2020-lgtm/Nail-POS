// fixtures-ci.mjs — POS Check-In one-screen datasets (tooling only; Check-In 27-inch mandate Oct 28 2026 §71–§72, §96,
// §104–§106). Shape = GET /pos/check-in/state (mapToCheckInState). Stateful: walk-ins and appointment check-ins are kept
// so the E2E can prove one tap = one visit (the server's idempotency key) and that the page refreshes in place.
//   empty   a salon before opening          normal  a typical morning
//   busy    §72: 25 waiting · 18 arriving appointments · 12 available technicians · 20 insights (5 sent) · data in charts
//   vbusy   50 waiting · 30 arriving · 200 technicians (100 on duty) · 1,000+ check-ins today
//   tech200 normal + the 200-technician roster        long  §104–§106 long guest / technician / service names
// `server=old` (BEFORE): the answer as it was — a 20-row page as "every" arrival / waiting guest, "available" = no queue
// entry (the whole roster page), a hard-coded 0 % trend, no totals, every appointment of the day as "arriving".
const FIRST = ['Ann', 'Bao', 'Chloe', 'Diana', 'Emily', 'Fiona', 'Grace', 'Hana', 'Ivy', 'Jenny', 'Kim', 'Linh', 'Mai', 'Nora', 'Olivia', 'Phuong', 'Quinn', 'Rosa', 'Sara', 'Thao'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vo', 'Smith', 'Johnson', 'Garcia', 'Martinez'];
const TECH = ['Lisa Tran', 'Mary Nguyen', 'Anna Pham', 'Kelly Le', 'Tina Vo', 'Jenny Hoang', 'Amy Dang', 'Vivian Do', 'Helen Bui', 'Cindy Ngo', 'Kim Ly', 'Rosa Vo', 'Emily Garcia', 'Sara Hoang'];
const SVC = [['Gel Manicure', 4500, 45], ['Spa Pedicure', 5500, 55], ['Acrylic Full Set', 6500, 75], ['Dip Powder', 5000, 60], ['Deluxe Pedicure', 7500, 65]];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SIZES = {
  empty: { waiting: 0, assigned: 0, serving: 0, arriving: 0, techs: 0, onDuty: 0, available: 0, insights: 0, checkIns: 0 },
  normal: { waiting: 5, assigned: 2, serving: 3, arriving: 6, techs: 12, onDuty: 9, available: 4, insights: 3, checkIns: 22 },
  busy: { waiting: 25, assigned: 6, serving: 10, arriving: 18, techs: 30, onDuty: 24, available: 12, insights: 20, checkIns: 68 },
  vbusy: { waiting: 50, assigned: 12, serving: 40, arriving: 30, techs: 200, onDuty: 100, available: 30, insights: 20, checkIns: 1040 },
  tech200: { waiting: 5, assigned: 2, serving: 3, arriving: 6, techs: 200, onDuty: 100, available: 20, insights: 3, checkIns: 22 },
  long: { waiting: 8, assigned: 2, serving: 3, arriving: 8, techs: 12, onDuty: 9, available: 4, insights: 4, checkIns: 26 },
};
const LONG_GUEST = 'Alexandria Montgomery-Santos';
const LONG_SVC = 'Deluxe Organic Spa Pedicure with Extended Massage';

export function checkInDataset(name, server) {
  const z = SIZES[name] || SIZES.normal; const old = server === 'old'; const long = name === 'long';
  const now = Date.now(); const isoAgo = (m) => new Date(now - m * 60000).toISOString();
  const cust = (n) => (long && n % 2 === 0 ? LONG_GUEST : `${FIRST[(n * 7) % 20]} ${LAST[(n * 3 + Math.floor(n / 20)) % 10]}`);
  const tech = (n) => (long && n % 3 === 0 ? `${TECH[n % TECH.length]}-Montgomery-Washington` : n < TECH.length ? TECH[n] : `Technician ${n + 1}`);
  const svc = (n) => (long && n % 2 === 0 ? LONG_SVC : SVC[n % 5][0]);
  const phone = (n) => `(856) 555-${String(1000 + n).slice(-4)}`;
  // today's active check-ins: waiting (longest first), assigned (sent to a technician), in service
  const rows = [];
  for (let i = 0; i < z.waiting; i++) rows.push({ rowId: id(1000 + i), st: 'checked_in', min: 4 + i * 2, n: i, tech: i % 4 === 0 ? tech(i % 10) : null });
  for (let i = 0; i < z.assigned; i++) rows.push({ rowId: id(2000 + i), st: 'ready', min: 3 + i, n: 100 + i, tech: tech(i) });
  for (let i = 0; i < z.serving; i++) rows.push({ rowId: id(3000 + i), st: 'in_service', min: 20 + i * 3, n: 200 + i, tech: tech(i + 3) });
  rows.sort((a, b) => a.min - b.min);
  const arrivalRow = (r) => ({ rowId: r.rowId, timeLabel: '', checkedInAt: isoAgo(r.min), waitedMinutes: r.min, customerId: id(5000 + r.n), customerName: cust(r.n), avatarUrl: null, phone: phone(r.n), source: r.n % 3 === 0 ? 'appointment' : 'walk_in', services: [svc(r.n)], technicianName: r.tech || undefined, arrivalStatus: r.st });
  const waitingAll = rows.filter((r) => r.st === 'checked_in').sort((a, b) => b.min - a.min)
    .map((r) => ({ queueItemId: r.rowId, timeLabel: '', customerId: id(5000 + r.n), customerName: cust(r.n), avatarUrl: null, serviceName: svc(r.n), status: 'waiting', waitedMinutes: r.min, requestedTechnicianName: r.tech || undefined }));
  // appointments not yet checked in, from 40 min ago (late) through 3 h from now — plus later ones the OLD server also sent
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const hhmm = (m) => { const v = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
  const apptAll = [];
  for (let i = 0; i < z.arriving + (old ? Math.round(z.arriving / 2) : 0); i++) apptAll.push({ appointmentId: id(20000 + i), timeLabel: '', startTime: hhmm(nowMin - 40 + i * 12), customerId: id(6000 + i), customerName: cust(300 + i), avatarUrl: null, serviceName: svc(i + 1), status: 'upcoming', technicianName: tech(i % 8) });
  // technicians: the on-duty projection (new) or the roster page by "has no queue entry" (old)
  const ST = (i) => (i < z.available ? 'Available' : i < z.available + Math.round((z.onDuty - z.available) / 4) ? 'Finishing Soon' : i < z.onDuty - 2 ? 'Busy' : 'Break');
  const techRows = []; for (let i = 0; i < z.onDuty; i++) techRows.push({ technicianId: id(9000 + i), displayName: tech(i), avatarUrl: null, activeAssignments: i % 3, status: ST(i) === 'Available' ? 'available' : 'busy', staffStatus: ST(i), load: i % 3, next: ST(i) === 'Available' ? 'Now' : ST(i) === 'Break' ? '—' : String(5 + (i % 30)), specialty: ['Manicure, Pedicure', 'Acrylic, Dip', 'Pedicure, Waxing'][i % 3] });
  const insightIds = [['longWait', 'warn', { count: 9, minutes: 15 }, '/queue'], ['late', 'warn', { count: 2 }, '/booking'], ['arriving', 'info', { count: 3, minutes: 20 }, null], ['available', 'info', { count: z.available }, '/queue?assign=1'], ['wait', 'warn', { minutes: 24 }, '/technicians'], ['vip', 'info', { count: 2 }, null], ['walkin', 'info', { percent: 62 }, null], ['peak', 'info', { hour: 13, count: 9 }, null]];
  const insights = []; for (let i = 0; i < z.insights; i++) { const [iid, sev, vars, route] = insightIds[i % insightIds.length]; insights.push({ id: i < insightIds.length ? iid : `${iid}_${i}`, text: `${iid} insight`, severity: sev, vars, ...(route ? { route } : {}) }); }
  const trend = z.checkIns ? Array.from({ length: Math.min(12, 3 + Math.floor(z.checkIns / 8)) }, (_, i) => ({ hour: 9 + i, hourLabel: '', count: Math.max(0, Math.round((z.checkIns / 10) * Math.sin((i + 1) / 2.4) + 2)) })) : [];
  const svcs = SVC.map((s, i) => ({ serviceId: id(30000 + i), name: s[0], durationMinutes: s[2], priceCents: s[1] }));
  const kpis = { todayCheckIns: z.checkIns, todayCheckInsTrendPercent: old ? 0 : z.checkIns ? 12.5 : null, waitingGuests: z.waiting, estimatedWaitMinutes: z.waiting ? 14 + Math.round(z.waiting / 3) : 0, walkInsToday: Math.round(z.checkIns * 0.62), appointmentsArrived: Math.round(z.checkIns * 0.38), appointmentArrivalPercent: z.checkIns ? 86 : 0, readyForTech: z.assigned, noShows: old ? 0 : Math.round(z.arriving / 9), techsAvailable: z.available, customerReturnRate: z.checkIns ? 64.3 : 0 };
  const walkIns = []; const keys = new Map(); const log = [];
  const state = () => {
    const extra = walkIns.map((w, i) => ({ rowId: w.id, timeLabel: '', checkedInAt: w.at, waitedMinutes: 0, customerId: '', customerName: w.name, avatarUrl: null, phone: '', source: 'walk_in', services: ['Gel Manicure'], arrivalStatus: 'checked_in' }));
    const arrivals = [...extra, ...rows.map(arrivalRow)];
    const waiting = [...extra.map((e) => ({ queueItemId: e.rowId, timeLabel: '', customerId: '', customerName: e.customerName, serviceName: 'Gel Manicure', status: 'waiting', waitedMinutes: 0 })), ...waitingAll];
    const base = {
      kpis: { ...kpis, todayCheckIns: kpis.todayCheckIns + walkIns.length, waitingGuests: kpis.waitingGuests + walkIns.length },
      readyForAssignment: [], services: svcs, technicians: [], sourceMix: z.checkIns ? [{ name: 'Walk-In', source: 'walk_in', count: Math.round(z.checkIns * 0.62), pct: 62 }, { name: 'Appointment', source: 'appointment', count: Math.round(z.checkIns * 0.28), pct: 28 }, { name: 'Customer App', source: 'customer_app', count: Math.round(z.checkIns * 0.06), pct: 6 }, { name: 'Online', source: 'online', count: Math.round(z.checkIns * 0.04), pct: 4 }] : [],
      arrivalTrend: trend, customerType: z.checkIns ? { returning: Math.round(z.checkIns * 0.6), new: Math.round(z.checkIns * 0.3), vip: Math.round(z.checkIns * 0.1), returnRatePct: 64.3 } : { returning: 0, new: 0, vip: 0, returnRatePct: 0 },
      dailyPerformance: { checkInsCompleted: z.checkIns, noShowRatePct: z.checkIns ? 4.2 : 0, avgCheckInSeconds: null, satisfaction: z.checkIns ? 4.8 : null },
    };
    if (old) {
      const page = (a) => a.slice(0, 20);
      const roster = []; for (let i = 0; i < Math.min(5, z.techs); i++) roster.push({ technicianId: id(9000 + i), displayName: tech(i), avatarUrl: null, activeAssignments: i % 2, status: i % 2 ? 'busy' : 'available' });
      return { ...base, arrivals: page(arrivals), waiting: page(waiting), appointmentCheckIn: { upcoming: apptAll, arrived: [], noShow: [] }, availableTechnicians: roster, technicianPage: { page: 1, pageSize: 5, total: z.techs, totalPages: Math.ceil(z.techs / 5) || 1, totalAll: z.techs },
        frontDeskInsights: insights.map(({ route, ...x }) => x) };
    }
    return { ...base, arrivals: arrivals.slice(0, 8), waiting: waiting.slice(0, 6), appointmentCheckIn: { upcoming: apptAll.slice(0, 6), arrived: [], noShow: [] }, availableTechnicians: techRows.slice(0, 6),
      technicianPage: { page: 1, pageSize: 6, total: techRows.length, totalPages: Math.ceil(techRows.length / 6) || 1, totalAll: z.techs },
      frontDeskInsights: insights.slice(0, 5), totals: { arrivals: arrivals.length, arriving: apptAll.length, waiting: waiting.length, onDuty: z.onDuty, available: z.available, insights: insights.length }, arrivalWindowMinutes: 180,
      staffSummary: { onDuty: z.onDuty, available: z.available, finishing: Math.round((z.onDuty - z.available) / 4), busy: Math.max(0, z.onDuty - z.available - Math.round((z.onDuty - z.available) / 4) - 2), onBreak: Math.min(2, z.onDuty), roster: z.techs } };
  };
  return {
    walkIns, log,
    route(method, path, qs, body) {
      if (method === 'GET' && path === '/pos/check-in/state') return state();
      if (method === 'GET' && path === '/pos/check-in/customers/search') return [{ customerId: id(5900), fullName: 'Jessica Miller', phone: '(415) 555-1212', totalVisits: 7 }];
      if (method === 'POST' && path === '/pos/check-in/walk-in') {   // §28: one key = one visit
        log.push({ kind: 'walk-in', key: body?.idempotencyKey ?? null, body });
        const k = body?.idempotencyKey; if (k && keys.has(k)) return keys.get(k);
        const w = { id: id(70000 + walkIns.length), name: body?.customerName || 'Guest', at: new Date().toISOString() }; walkIns.push(w);
        const row = { checkInId: w.id, customerName: w.name, status: 'checked_in', source: 'walk_in', services: [], checkedInAt: w.at }; if (k) keys.set(k, row); return row;
      }
      const m = /^\/pos\/check-in\/appointment\/(.+)$/.exec(path);
      if (method === 'POST' && m) { log.push({ kind: 'appointment', id: m[1] }); const a = apptAll.findIndex((x) => x.appointmentId === m[1]); if (a >= 0) apptAll.splice(a, 1); return { checkInId: id(80000), status: 'checked_in' }; }
      const d = /^\/pos\/check-in\/([0-9a-f-]{36})$/.exec(path);
      if (method === 'GET' && d) { const r = rows.find((x) => x.rowId === d[1]); const w = walkIns.find((x) => x.id === d[1]); if (!r && !w) return { __status: 404, body: { message: 'Check-in not found' } };
        return r ? { checkInId: r.rowId, customerName: cust(r.n), customerPhone: phone(r.n), services: [{ serviceName: svc(r.n), durationMinutes: 45 }], technicianName: r.tech, status: r.st === 'ready' ? 'sent_to_tech_queue' : r.st, source: r.n % 3 === 0 ? 'appointment' : 'walk_in', checkedInAt: isoAgo(r.min), notes: r.n === 0 ? 'Prefers almond oil' : '' }
          : { checkInId: w.id, customerName: w.name, services: [], status: 'checked_in', source: 'walk_in', checkedInAt: w.at }; }
      const a2 = /^\/pos\/check-in\/([0-9a-f-]{36})\/(move-to-queue|start-service|update-wait-estimate|assign-technician)$/.exec(path);
      if (method === 'POST' && a2) { log.push({ kind: a2[2], id: a2[1] }); return { moved: true, duplicate: false }; }
      return undefined;
    },
  };
}
