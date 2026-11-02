// fixtures-lo.mjs — POS Live Operations one-screen datasets (tooling only; Live Operations 27-inch mandate Oct 28 2026
// §19, §23–§24, §26). Shape = GET /pos/dashboard/state (POSDashboardState) + the range endpoints the period selectors call.
//   empty  a salon before opening   normal  a typical day   busy  12 services in progress · 8 AI insights · 6 locations
//   vbusy  40 in progress · 200 technicians · 30 insights · 14 locations · $2,450,000 today (§8 large values)
//   tech200 normal + 200 technicians   long  long guest / technician / service / branch names
const FIRST = ['Ann', 'Bao', 'Chloe', 'Diana', 'Emily', 'Fiona', 'Grace', 'Hana', 'Ivy', 'Jenny', 'Kim', 'Linh', 'Mai', 'Nora', 'Olivia', 'Phuong', 'Quinn', 'Rosa', 'Sara', 'Thao'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Vo', 'Smith', 'Johnson', 'Garcia', 'Martinez'];
const TECH = ['Lisa Tran', 'Mary Nguyen', 'Anna Pham', 'Kelly Le', 'Tina Vo', 'Jenny Hoang', 'Amy Dang', 'Vivian Do'];
const SVC = ['Gel Manicure', 'Spa Pedicure', 'Acrylic Full Set', 'Dip Powder', 'Deluxe Pedicure', 'Nail Art'];
const SIZES = {
  empty: { live: 0, insights: 0, locs: 0, techs: 0, onDuty: 0, rev: 0, appts: 0, checkIns: 0 },
  normal: { live: 5, insights: 3, locs: 3, techs: 12, onDuty: 9, rev: 184250, appts: 22, checkIns: 24 },
  busy: { live: 12, insights: 8, locs: 6, techs: 16, onDuty: 14, rev: 1245075, appts: 48, checkIns: 68 },
  vbusy: { live: 40, insights: 30, locs: 14, techs: 200, onDuty: 100, rev: 245000000, appts: 400, checkIns: 1040 },
  tech200: { live: 5, insights: 3, locs: 3, techs: 200, onDuty: 100, rev: 184250, appts: 22, checkIns: 24 },
  long: { live: 6, insights: 4, locs: 4, techs: 12, onDuty: 9, rev: 999999, appts: 26, checkIns: 26 },
};
export function liveOpsDataset(name, server) {
  const z = SIZES[name] || SIZES.normal; const old = server === 'old'; const long = name === 'long';
  const now = Date.now();
  const cust = (n) => (long && n % 2 === 0 ? 'Alexandria Montgomery-Santos' : `${FIRST[(n * 7) % 20]} ${LAST[(n * 3) % 10]}`);
  const tech = (n) => (long && n % 3 === 0 ? 'Alexandria Montgomery-Santos' : n < TECH.length ? TECH[n] : `Technician ${n + 1}`);
  const svc = (n) => (long && n % 2 === 0 ? 'Deluxe Organic Spa Pedicure with Extended Massage' : SVC[n % SVC.length]);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const trend = (period) => {
    const n = period === 'month' ? 28 : period === 'today' ? 1 : 7; const base = z.rev || 0;
    const series = z.rev ? Array.from({ length: n }, (_, i) => ({ label: days[i % 7], date: new Date(now - (n - 1 - i) * 86400000).toISOString().slice(0, 10), valueCents: Math.round(base * (0.6 + 0.4 * Math.abs(Math.sin(i + 1)))), apptCount: Math.round(z.appts * (0.5 + 0.5 * Math.abs(Math.cos(i)))) })) : [];
    return { period, totalCents: series.reduce((a, p) => a + p.valueCents, 0), trendPercent: z.rev ? 8.4 : 0, series };
  };
  const svcs = (r) => (z.rev ? SVC.slice(0, 5).map((nm, i) => ({ name: svc(i) || nm, revenueCents: Math.round((z.rev / (i + 2)) * (r === 'month' ? 20 : r === 'week' ? 6 : 1)) })) : []);
  const pay = (r) => (z.rev ? { period: r, entries: [['card', 62], ['cash', 21], ['gift_card', 9], ['split', 5], ['other', 3]].map(([m, p]) => ({ method: m, percent: p, amountCents: Math.round(z.rev * p / 100) })) } : { period: r, entries: [] });
  const ins = ['peak_time', 'staffing', 'missed_calls', 'upsell', 'rebooking', 'low_stock'];
  const state = () => ({
    context: { salonName: long ? 'The Grand Luxury Nail & Wellness Studio of Cherry Hill' : 'Pilot Nail Salon', branchName: 'Main' },
    kpis: { todayRevenueCents: z.rev, todayRevenueTrendPercent: z.rev ? 12.4 : 0, waitingGuests: Math.round(z.live * 1.2), servingNow: z.live, readyCheckout: Math.round(z.live / 2), activeTechs: z.onDuty, totalTechs: Math.max(z.onDuty, Math.round(z.techs * 0.6)),
      onlineBookings: Math.round(z.appts / 4), monthlyCardVolumeCents: z.rev * 18, checkInsToday: z.checkIns, appointmentsToday: z.appts, averageTicketCents: z.checkIns ? Math.round(z.rev / Math.max(1, z.checkIns)) : 0,
      customerRetentionPercent: z.rev ? 58.4 : 0, aiBookingConversionPercent: z.rev ? 31 : 0, monthlyCardVolumeTrendPercent: z.rev ? 6.2 : 0, checkInsTodayTrendPercent: z.rev ? 9 : 0, appointmentsTodayTrendPercent: z.rev ? -3 : 0, averageTicketTrendPercent: z.rev ? 4.1 : 0 },
    calendar: { appointments: [], technicians: [] },
    todaysAppointments: { totalAppointments: z.appts, completed: Math.round(z.appts / 3), noShow: Math.round(z.appts / 20), cancelled: 1, remaining: Math.round(z.appts / 2), completedPercent: 33 },
    walkInStatus: { waitingCount: Math.round(z.live * 1.2), estimatedWaitMinutes: z.live ? 18 : 0, checkedInNotAssigned: Math.round(z.live / 3) },
    operationsSnapshot: { waitingGuests: Math.round(z.live * 1.2), estWaitMinutes: z.live ? 18 : 0, walkInsToday: Math.round(z.checkIns * 0.6), walkInPercent: z.checkIns ? 60 : 0, readyCheckout: Math.round(z.live / 2), readyCheckoutValueCents: Math.round(z.live / 2) * 6500, completedServices: Math.round(z.appts / 3), noShows: Math.round(z.appts / 20), noShowPercent: z.appts ? 5 : 0, upcomingNext3h: Math.round(z.appts / 6) },
    revenueTrend: trend('week'), topServices: svcs('today'),
    topTechnicians: Array.from({ length: Math.min(z.onDuty, old ? 200 : 10) }, (_, i) => ({ technicianId: `t${i}`, name: tech(i), revenueCents: Math.round(z.rev / (i + 2)), servicesCount: 12 - (i % 10), tipsCents: Math.round(z.rev / (i + 2) / 8), utilizationPercent: 90 - i, rating: 4.9 - (i % 5) / 10 })),
    paymentMix: pay('week'),
    liveActivity: Array.from({ length: Math.min(z.live, 8) }, (_, i) => ({ time: '', startedAt: new Date(now - (5 + i * 6) * 60000).toISOString(), guestName: cust(i), serviceName: svc(i), technicianName: tech(i), status: 'in_progress', elapsedMinutes: 5 + i * 6 })),
    ...(old ? {} : { liveActivityTotal: z.live }),
    customerRetention: z.rev ? { returningPercent: 58.4, returningCount: 584, newPercent: 27.1, newCount: 271, inactivePercent: 14.5, inactiveCount: 145, totalCustomers: 1000 } : { returningPercent: 0, returningCount: 0, newPercent: 0, newCount: 0, inactivePercent: 0, inactiveCount: 0, totalCustomers: 0 },
    multiLocation: z.locs > 1 ? Array.from({ length: z.locs }, (_, i) => ({ branchId: `b${i}`, branchName: long && i === 0 ? 'The Grand Luxury Nail & Wellness Studio of Cherry Hill' : `${['Main', 'Voorhees', 'Marlton', 'Moorestown', 'Haddonfield', 'Mount Laurel', 'Medford'][i % 7]}${i >= 7 ? ' ' + (i + 1) : ''}`, revenueCents: Math.round(z.rev / (i + 1)), checkIns: Math.round(z.checkIns / (i + 1)), trendPercent: i % 2 ? -2.1 : 4.3 })) : [],
    quickInsights: [],
    aiInsights: Array.from({ length: z.insights }, (_, i) => ({ id: i < ins.length ? ins[i] : `${ins[i % ins.length]}_${i}`, icon: 'peak', tone: ['info', 'warning', 'success', 'danger'][i % 4], primary: `Insight ${i + 1}`, secondary: 'Details for the front desk.', vars: { count: 3 + i, fromHour: 13, toHour: 15, service: 'Gel Manicure', valueCents: 12000 }, ...(i % 2 ? { action: { label: 'View', kind: ['missed_calls', 'inventory', 'rebooking'][i % 3] } } : {}) })),
  });
  return {
    route(method, path, qs) {
      if (method !== 'GET') return undefined;
      if (path === '/pos/dashboard/state') return state();
      if (path === '/pos/dashboard/revenue-trend') return trend(qs.get('range') || 'week');
      if (path === '/pos/dashboard/top-services') return svcs(qs.get('range') || 'today');
      if (path === '/pos/dashboard/payment-mix') return pay(qs.get('range') || 'week');
      return undefined;
    },
  };
}
