// fixtures-ov.mjs — POS Overview one-screen datasets (tooling only; Overview 27-inch mandate Oct 28 2026 §5, §32, §35–§36).
// Shapes follow GET /pos/overview/state (PosOverviewResponse) and GET /pos/overview/board (OverviewBoard). Money in cents.
//   empty    a salon that has not opened yet          normal  a typical mid-morning
//   busy     §5: 18 waiting · 10 active technicians · 12 active services · 8 ready for checkout · 30 appointments ·
//            20 communications · 10 AI insights · 5 payment methods · technician performance · 20 inventory alerts
//   vbusy    50 arrivals · 200 technicians (100 on duty) · 40 appointments · 300 communications · 30 insights ·
//            100 inventory alerts · $2,450,000 revenue (§10 large values)
//   tech200  normal + the 200-technician roster        long   §36 long salon / employee / guest / service names
// `server=old` (BEFORE): the server as it was — no totals, no computed minutes left, no messages, decorative insights.
const FIRST = ['Ann', 'Bao', 'Chloe', 'Diana', 'Emily', 'Fiona', 'Grace', 'Hana', 'Ivy', 'Jenny', 'Kim', 'Linh', 'Mai', 'Nora', 'Olivia', 'Phuong', 'Quinn', 'Rosa', 'Sara', 'Thao'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vo', 'Smith', 'Johnson', 'Garcia', 'Martinez'];
const TECH = ['Lisa Tran', 'Mary Nguyen', 'Anna Pham', 'Kelly Le', 'Tina Vo', 'Jenny Hoang', 'Amy Dang', 'Vivian Do', 'Helen Bui', 'Cindy Ngo'];
const SVC = [['Gel Manicure', 4500, 45], ['Spa Pedicure', 5500, 55], ['Acrylic Full Set', 6500, 75], ['Dip Powder', 5000, 60], ['Deluxe Pedicure', 7500, 65]];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SIZES = {
  empty: { waiting: 0, serving: 0, ready: 0, appts: 0, comms: 0, insights: 0, techs: 0, onDuty: 0, inventory: 0, pay: 0, revenue: 0 },
  normal: { waiting: 5, serving: 6, ready: 3, appts: 14, comms: 6, insights: 3, techs: 12, onDuty: 9, inventory: 3, pay: 3, revenue: 184250 },
  busy: { waiting: 18, serving: 12, ready: 8, appts: 30, comms: 20, insights: 10, techs: 14, onDuty: 10, inventory: 20, pay: 5, revenue: 1245075 },
  vbusy: { waiting: 50, serving: 40, ready: 20, appts: 40, comms: 300, insights: 30, techs: 200, onDuty: 100, inventory: 100, pay: 5, revenue: 245000000 },
  tech200: { waiting: 5, serving: 6, ready: 3, appts: 14, comms: 6, insights: 3, techs: 200, onDuty: 100, inventory: 3, pay: 3, revenue: 184250 },
  long: { waiting: 6, serving: 5, ready: 3, appts: 10, comms: 6, insights: 4, techs: 12, onDuty: 9, inventory: 4, pay: 3, revenue: 999999 },
};
export const LONG_SALON = 'The Grand Luxury Nail & Wellness Studio of Cherry Hill';
export const LONG_EMPLOYEE = 'Alexandria Montgomery-Santos';

export function overviewDataset(name, server) {
  const z = SIZES[name] || SIZES.normal; const old = server === 'old'; const long = name === 'long';
  const now = Date.now(); const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const cust = (n) => (long ? `${FIRST[n % 20]}-Alexandra ${LAST[n % 10]}-Washington-Montgomery` : `${FIRST[(n * 7) % 20]} ${LAST[(n * 3 + Math.floor(n / 20)) % 10]}`);
  const tech = (n) => (long && n % 3 === 0 ? LONG_EMPLOYEE : n < TECH.length ? TECH[n] : `Technician ${n + 1}`);
  const svc = (n) => (long ? 'Signature Deluxe Hot-Stone Spa Pedicure with Paraffin' : SVC[n % 5][0]);
  const today = new Date(now).toISOString().slice(0, 10);
  // schedule preview: today's appointments per technician
  const techCols = []; for (let t = 0; t < Math.min(z.techs, 200); t++) techCols.push({ technicianId: id(9000 + t), name: tech(t), role: 'Nail Technician', appointments: [] });
  const ST = ['completed', 'in_progress', 'confirmed', 'booked', 'arrived', 'waiting'];
  for (let a = 0; a < z.appts; a++) {
    const col = techCols[a % Math.max(1, Math.min(techCols.length, 10))]; if (!col) break;
    const h = 9 + Math.floor(a / 3); const m = (a % 3) * 20;
    col.appointments.push({ appointmentId: id(20000 + a), customerId: id(5000 + a), customerName: cust(a), serviceNames: [svc(a)], startTime: `${today}T${String(Math.min(h, 20)).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`, endTime: '', status: ST[a % ST.length], source: a % 4 ? 'staff_booking' : 'online', isVip: a % 9 === 0, amountCents: SVC[a % 5][1], durationMinutes: SVC[a % 5][2] });
  }
  const revenueTrend = z.revenue ? Array.from({ length: 7 }, (_, i) => ({ date: new Date(now - (6 - i) * 86400000).toISOString().slice(0, 10), revenueCents: Math.round(z.revenue * (0.55 + ((i * 37) % 50) / 100)) })) : [];
  const METHODS = ['card', 'cash', 'gift_card', 'tap_to_pay', 'other'];
  const SHARE = [52, 21, 12, 10, 5];
  const paymentMix = METHODS.slice(0, z.pay).map((method, i) => ({ method, amountCents: Math.round((z.revenue * SHARE[i]) / 100), percent: SHARE[i] }));
  const topTechnicians = Array.from({ length: Math.min(5, z.techs) }, (_, i) => ({ technicianId: id(9000 + i), technicianName: tech(i), revenueCents: Math.round(z.revenue / (3 + i)), completedServices: 9 - i, utilizationPercent: 88 - i * 7 }));
  const INS = [
    ['wait', 'Long wait at the front desk', '23 min longest wait', 'warning', 'queue'], ['checkout', 'Guests ready for checkout', '8 waiting to pay', 'warning', 'checkout'],
    ['break', 'Staff on break right now', '2 technicians', 'info', 'team'], ['inventory', 'Inventory low', '20 products at or below reorder', 'danger', 'inventory'],
    ['revenue', 'High revenue service', 'Acrylic Full Set', 'success', 'reports'], ['booking', 'Open slots this afternoon', '6 open between 2 and 5 PM', 'info', 'booking'],
  ];
  // new server: the advisory rules of overview-floor.ts (id + vars + route); old: the always-on decorative trio
  const NEW_INS = [['long_wait', 'Unusual wait time', 'danger', '/queue', { minutes: 2 + (z.waiting - 1) * 3, waiting: z.waiting }], ['unassigned', 'Guests waiting for a technician', 'warning', '/queue?assign=1', { count: Math.round(z.waiting * 0.6), free: 3 }],
    ['checkout_backlog', 'Guests ready for checkout', 'warning', '/checkout', { count: z.ready }], ['inventory_low', 'Inventory low', 'danger', '/tenant/inventory', { count: z.inventory }], ['staff_on_break', 'Staff on break right now', 'info', '/technicians', { count: Math.round(z.onDuty * 0.1), onDuty: z.onDuty }]];
  const quickInsights = old ? Array.from({ length: z.insights }, (_, i) => { const x = INS[i % INS.length]; return { type: x[0], title: long ? `${x[1]} — ${cust(i)} requested ${svc(i)}` : x[1], value: x[2], severity: x[3] }; })
    : NEW_INS.slice(0, Math.min(5, z.insights)).map(([id, title, severity, route, vars]) => ({ id, type: id, title, severity, route, vars }));
  const state = {
    context: { tenantId: id(1), branchId: id(2), salonName: long ? LONG_SALON : 'Pilot Nail Salon', branchName: 'Main Location', businessDate: today, timezone: 'America/New_York' },
    kpis: {
      todayRevenue: { amountCents: z.revenue, displayAmount: '$' + (z.revenue / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }), changePercent: z.revenue ? 12.4 : 0, comparisonLabel: 'vs yesterday' },
      todayCheckIns: { count: z.waiting + z.serving + z.ready + z.appts, change: 3, changePercent: z.appts ? 8 : 0 },
      walkInsToday: { count: Math.round(z.waiting * 0.6), change: 1, changePercent: old ? 0 : (z.waiting ? 5 : 0) },
      averageTicket: { amountCents: z.revenue ? Math.round(z.revenue / Math.max(1, z.appts)) : 0, displayAmount: z.revenue ? '$' + (z.revenue / Math.max(1, z.appts) / 100).toFixed(2) : '$0.00', changePercent: z.revenue ? -2.1 : 0 },
      waitingGuests: { count: z.waiting }, servingNow: { count: z.serving }, readyCheckout: { count: z.ready },
      activeTechs: { active: z.onDuty, scheduled: Math.max(z.onDuty, Math.round(z.onDuty * 1.15)), ...(old ? {} : { onBreak: Math.round(z.onDuty * 0.1) }) },
      onlineBookings: { count: Math.round(z.appts / 4) },
    },
    schedulePreview: { date: today, technicians: techCols, openSlots: [] },
    todayAppointments: { total: z.appts, completed: Math.round(z.appts / 6), noShow: z.appts ? 1 : 0, cancelled: 0, remaining: Math.max(0, z.appts - Math.round(z.appts / 6) - 1) },
    checkoutToday: { paidTickets: Math.round(z.appts / 3), tipsCents: Math.round(z.revenue * 0.12), longestWaitMinutes: z.waiting ? 2 + (z.waiting - 1) * 3 : 0 },
    walkInStatus: { waiting: z.waiting, estimatedWaitMinutes: z.waiting * 4, checkedInNotAssigned: Math.round(z.waiting * 0.6) },
    analytics: { revenueTrend, topTechnicians, paymentMix, quickInsights, topServices: [] },
  };
  const arrivalsAll = Array.from({ length: z.waiting }, (_, i) => ({ startTime: iso(2 + i * 3), customerName: cust(i), serviceName: svc(i), status: ['waiting', 'called', 'assigned', 'ready_for_tech'][i % 4], waitMinutes: 2 + i * 3 }));
  const liveAll = Array.from({ length: z.serving }, (_, i) => ({ technicianName: tech(i), serviceName: svc(i + 1), customerName: cust(i + 50), minutesLeft: old ? null : Math.max(0, 50 - i * 7), status: 'in_service' }));
  const assignAll = arrivalsAll.filter((a) => a.status === 'waiting' || a.status === 'called').map((a, i) => ({ customerName: a.customerName, serviceName: a.serviceName, requestedTech: i % 2 ? tech(i) : 'Any Available' }));
  const checkoutAll = Array.from({ length: z.ready }, (_, i) => ({ customerName: cust(i + 80), amountCents: SVC[i % 5][1] + 1200 }));
  const remindersAll = Array.from({ length: z.comms }, (_, i) => ({ customerName: cust(i + 100), service: svc(i), whenLabel: `Today, ${1 + (i % 11)}:${i % 2 ? '30' : '00'} PM`, channel: i % 3 ? 'sms' : 'email', status: ['sent', 'delivered', 'failed', 'scheduled'][i % 4] }));
  const messagesAll = Array.from({ length: Math.round(z.comms / 2) }, (_, i) => ({ customerName: cust(i + 200), preview: long ? 'Hi! Can I move my appointment from Saturday afternoon to Sunday morning and also add a paraffin treatment?' : 'Can I move my appointment to 3 PM?', unread: i % 3 === 0, at: iso(5 + i * 4) }));
  const invAll = Array.from({ length: z.inventory }, (_, i) => ({ product: long ? 'OPI Infinite Shine Long-Wear Lacquer — Big Apple Red (15 ml)' : ['OPI Gel Base', 'Acetone 1 gal', 'Cuticle Oil', 'Nail Files 100/180', 'Dip Powder Clear', 'Paraffin Wax'][i % 6] + (i >= 6 ? ` #${i}` : ''), stock: i % 5 === 0 ? 0 : 1 + (i % 4), reorderLevel: 6, status: i % 5 === 0 ? 'out' : i % 3 === 0 ? 'critical' : 'low' }));
  // the rows each server sent: old LIMITs vs OVERVIEW_TOP_ROWS (overview-floor.ts)
  const LIM = old ? { arrivals: 7, live: 5, assign: 5, checkout: 5, reminders: 8, inventory: 8 } : { arrivals: 7, live: 6, assign: 5, checkout: 5, reminders: 6, inventory: 6 };
  const cap = (a, n) => a.slice(0, n);
  const board = {
    communications: { reminders: cap(remindersAll, LIM.reminders), messages: old ? [] : messagesAll.slice(0, 6), missedCalls: [], missedCallsAvailable: false, ...(old ? {} : { messagesAvailable: true }) },
    customerRetention: z.appts ? { returningPercent: 58.4, newPercent: 27.1, inactivePercent: 14.5 } : null,
    inventoryAlerts: cap(invAll, LIM.inventory), arrivals: cap(arrivalsAll, LIM.arrivals), liveTechQueue: cap(liveAll, LIM.live), readyForAssignment: cap(assignAll, LIM.assign), readyForCheckout: cap(checkoutAll, LIM.checkout),
    lastUpdatedAt: new Date(now).toISOString(),
    ...(old ? {} : { totals: { arrivals: arrivalsAll.length, liveTechQueue: liveAll.length, readyForAssignment: assignAll.length, readyForCheckout: checkoutAll.length, inventoryAlerts: invAll.length, reminders: remindersAll.length, messages: messagesAll.length, unreadMessages: messagesAll.filter((m) => m.unread).length } }),
  };
  return {
    salonName: long ? LONG_SALON : null, employeeName: long ? LONG_EMPLOYEE : null,
    route(method, path, qs) {
      if (method !== 'GET') return undefined;
      if (path === '/pos/overview/state') return state;
      if (path === '/pos/overview/board') return board;
      if (path === '/tenant/navigation') return undefined;   // the server patches aiPackages / salonName (below)
      return undefined;
    },
  };
}
