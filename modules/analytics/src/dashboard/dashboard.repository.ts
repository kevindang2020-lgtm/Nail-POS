/**
 * dashboard.repository.ts — repo PORT for the POS Dashboard aggregate + a runnable
 * in-memory implementation (seeded). Production Kysely impl runs the consolidated
 * scoped query and maps rows to POSDashboardState, applying scoped()
 * (WHERE tenant_id = :tenantId AND (branch_id = :branchId OR branch_id IS NULL)).
 * Scope is derived server-side from the session — never from the client.
 */
import type { POSDashboardState } from './dashboard.dto';
import { buildAiInsights } from './dashboard.dto';

export interface DashboardScope { tenantId: string; branchId: string | null; /** null / absent = every branch */ branchIds?: string[] | null; }
export interface DashboardQuery { date?: string; range?: 'today' | 'week' | 'month'; }

export interface DashboardRepo {
  getAggregate(scope: DashboardScope, q: DashboardQuery): Promise<POSDashboardState>;
}

export function emptyDashboard(scope: DashboardScope): POSDashboardState {
  return {
    context: { tenantId: scope.tenantId, branchId: scope.branchId || '', salonName: '', branchName: '' },
    kpis: {
      todayRevenueCents: 0, todayRevenueTrendPercent: 0, waitingGuests: 0, waitingTrendCount: 0,
      servingNow: 0, servingTrendCount: 0, readyCheckout: 0, readyCheckoutTrendCount: 0,
      activeTechs: 0, totalTechs: 0, customerSatisfactionScore: 0, customerSatisfactionMax: 5,
      onlineBookings: 0, onlineBookingsTrendCount: 0,
      monthlyCardVolumeCents: 0, checkInsToday: 0, appointmentsToday: 0, averageTicketCents: 0,
      customerRetentionPercent: 0, aiBookingConversionPercent: 0, monthlyCardVolumeTrendPercent: 0, checkInsTodayTrendPercent: 0, appointmentsTodayTrendPercent: 0, averageTicketTrendPercent: 0, customerRetentionTrendPercent: 0, aiBookingConversionTrendPercent: 0,
    },
    calendar: { date: '', technicians: [], appointments: [], openSlots: [] },
    todaysAppointments: { totalAppointments: 0, completed: 0, noShow: 0, cancelled: 0, remaining: 0, completedPercent: 0 },
    walkInStatus: { waitingCount: 0, estimatedWaitMinutes: 0, checkedInNotAssigned: 0 },
    operationsSnapshot: { waitingGuests: 0, estWaitMinutes: 0, walkInsToday: 0, walkInPercent: 0, readyCheckout: 0, readyCheckoutValueCents: 0, completedServices: 0, noShows: 0, noShowPercent: 0, upcomingNext3h: 0 },
    currentTicket: undefined,
    guestSnapshot: undefined,
    revenueTrend: { period: 'week', totalCents: 0, trendPercent: 0, series: [] },
    topServices: [],
    topTechnicians: [],
    paymentMix: { period: 'week', entries: [] },
    liveActivity: [],
    customerRetention: { returningPercent: 0, returningCount: 0, newPercent: 0, newCount: 0, inactivePercent: 0, inactiveCount: 0, totalCustomers: 0 },
    multiLocation: [],
    quickInsights: [],
    aiInsights: [],
    quickActions: [],
  };
}

const SEED_TENANT = 'luxe001';
const SEED_BRANCH = 'br_cherryhill';

function seededDashboard(scope: DashboardScope): POSDashboardState {
  return {
    context: { tenantId: scope.tenantId, branchId: scope.branchId || SEED_BRANCH, salonName: 'Luxe Nails & Spa', branchName: 'Cherry Hill' },
    kpis: {
      todayRevenueCents: 846250, todayRevenueTrendPercent: 18.6, waitingGuests: 14, waitingTrendCount: 7,
      servingNow: 22, servingTrendCount: 3, readyCheckout: 6, readyCheckoutTrendCount: 2,
      activeTechs: 10, totalTechs: 16, customerSatisfactionScore: 4.8, customerSatisfactionMax: 5,
      onlineBookings: 27, onlineBookingsTrendCount: 9,
      monthlyCardVolumeCents: 6489260, checkInsToday: 32, appointmentsToday: 28, averageTicketCents: 8261,
      customerRetentionPercent: 68.4, aiBookingConversionPercent: 36.2, monthlyCardVolumeTrendPercent: 22.4, checkInsTodayTrendPercent: 14.3, appointmentsTodayTrendPercent: 21.7, averageTicketTrendPercent: 5.2, customerRetentionTrendPercent: 6.7, aiBookingConversionTrendPercent: 8.1,
    },
    calendar: {
      date: '2026-06-05',
      technicians: [
        { id: 'tech_maria', displayName: 'Maria', roleLabel: 'Nail Artist', colorKey: 'pink' },
        { id: 'tech_linh', displayName: 'Linh', roleLabel: 'Nail Tech', colorKey: 'purple' },
      ],
      appointments: [
        { id: 'apt_1', customerId: 'c1', customerName: 'Sophia Nguyen', technicianId: 'tech_maria', serviceNames: ['Gel Manicure'], startTime: '10:00', endTime: '11:00', status: 'confirmed', source: 'online_booking' },
        { id: 'apt_2', customerId: 'c2', customerName: 'Mia Johnson', technicianId: 'tech_linh', serviceNames: ['Acrylic Full Set'], startTime: '10:00', endTime: '11:00', status: 'confirmed', source: 'walk_in' },
        { id: 'apt_3', customerId: 'c3', customerName: 'Olivia Brown', technicianId: 'tech_linh', serviceNames: ['Gel Manicure'], startTime: '14:00', endTime: '15:00', status: 'serving', source: 'phone' },
      ],
      openSlots: [{ technicianId: 'tech_vicki', startTime: '18:00', endTime: '19:00' }],
    },
    todaysAppointments: { totalAppointments: 24, completed: 8, noShow: 1, cancelled: 2, remaining: 13, completedPercent: 33 },
    walkInStatus: { waitingCount: 14, estimatedWaitMinutes: 35, checkedInNotAssigned: 4 },
    operationsSnapshot: { waitingGuests: 14, estWaitMinutes: 28, walkInsToday: 11, walkInPercent: 34, readyCheckout: 8, readyCheckoutValueCents: 124875, completedServices: 27, noShows: 2, noShowPercent: 7, upcomingNext3h: 18 },
    currentTicket: {
      ticketId: 'tk_1024', ticketNumber: 'SD-1024', customerId: 'c1', customerName: 'Sophia Martinez', customerPhone: '(555) 123-4567',
      isLoyaltyMember: true, checkedInLabel: 'Checked in 2:10 PM', technicianName: 'Maria',
      serviceLines: [{ name: 'Gel Manicure', priceCents: 3500 }, { name: 'Nail Art', priceCents: 1500 }],
      subtotalCents: 5000, taxCents: 331, taxRatePercent: 6.625, totalCents: 5331,
    },
    guestSnapshot: { customerId: 'c1', totalVisits: 18, lastVisitDate: '2026-05-20', totalSpentCents: 128900, loyaltyPoints: 640 },
    revenueTrend: {
      period: 'week', totalCents: 4623180, trendPercent: 12.4,
      series: [
        { label: 'S', valueCents: 360000, apptCount: 14 }, { label: 'M', valueCents: 300000, apptCount: 12 }, { label: 'T', valueCents: 440000, apptCount: 18 },
        { label: 'W', valueCents: 340000, apptCount: 15 }, { label: 'T', valueCents: 520000, apptCount: 22 }, { label: 'F', valueCents: 600000, apptCount: 26 }, { label: 'S', valueCents: 760000, apptCount: 31 },
      ],
    },
    topServices: [
      { name: 'Acrylic Full Set', revenueCents: 1263500 }, { name: 'Gel Manicure', revenueCents: 987000 },
      { name: 'Pedicure Deluxe', revenueCents: 742000 }, { name: 'Builder Gel Refill', revenueCents: 621000 }, { name: 'Nail Art Design', revenueCents: 398000 },
    ],
    topTechnicians: [
      { technicianId: 'tech_linh', name: 'Linh', revenueCents: 987000, servicesCount: 8, utilizationPercent: 94, tipsCents: 15200, rating: 4.9 }, { technicianId: 'tech_maria', name: 'Maria', revenueCents: 924500, servicesCount: 7, utilizationPercent: 88, tipsCents: 12000, rating: 4.8 },
      { technicianId: 'tech_vicki', name: 'Vicki', revenueCents: 856000, servicesCount: 6, utilizationPercent: 82, tipsCents: 9800, rating: 4.8 }, { technicianId: 'tech_tiff', name: 'Tiffany', revenueCents: 718500, servicesCount: 6, utilizationPercent: 76, tipsCents: 8600, rating: 4.7 }, { technicianId: 'tech_tony', name: 'Tony', revenueCents: 642000, servicesCount: 5, utilizationPercent: 75, tipsCents: 7000, rating: 4.7 },
    ],
    paymentMix: { period: 'week', entries: [ { method: 'card', percent: 72, amountCents: 3328600 }, { method: 'cash', percent: 20, amountCents: 924600 }, { method: 'other', percent: 8, amountCents: 369900 } ] },
    liveActivity: [
      { time: '2:33 PM', guestName: 'Jessica Miller', serviceName: 'Gel Mani', technicianName: 'Samantha Green', status: 'in_progress', elapsedMinutes: 25 },
      { time: '2:28 PM', guestName: 'Olivia Brown', serviceName: 'Acrylic Full Set', technicianName: 'Charlotte Taylor', status: 'in_progress', elapsedMinutes: 18 },
      { time: '2:25 PM', guestName: 'Emma Wilson', serviceName: 'Gel X Full Set', technicianName: 'Lily Adams', status: 'in_progress', elapsedMinutes: 15 },
      { time: '2:21 PM', guestName: 'Isabella Davis', serviceName: 'Spa Pedicure', technicianName: 'Mia Johnson', status: 'in_progress', elapsedMinutes: 20 },
      { time: '2:19 PM', guestName: 'Sophia Martinez', serviceName: 'Nail Art', technicianName: 'Grace Hall', status: 'in_progress', elapsedMinutes: 10 },
    ],
    customerRetention: { returningPercent: 68.4, returningCount: 245, newPercent: 22.1, newCount: 79, inactivePercent: 9.5, inactiveCount: 34, totalCustomers: 358 },
    multiLocation: [
      { branchId: 'br_downtown', branchName: 'Downtown Branch', revenueCents: 528730, checkIns: 32, trendPercent: 18.6 },
      { branchId: 'br_westfield', branchName: 'Westfield Mall', revenueCents: 384210, checkIns: 24, trendPercent: 15.3 },
      { branchId: 'br_riverside', branchName: 'Riverside Plaza', revenueCents: 261375, checkIns: 18, trendPercent: 12.8 },
    ],
    quickInsights: [
      { kind: 'busiest_window', text: '2PM - 6PM', tone: 'info' },
      { kind: 'high_revenue_service', text: 'Acrylic Full Set', tone: 'success' },
      { kind: 'staff_on_break', text: '5 staff on break right now', tone: 'warning' },
      { kind: 'inventory_low', text: '3 items low', tone: 'danger' },
    ],
    // Dev fixture: the six insights exactly as the reference (§27). Production derives each from real data
    // (peak window, staffing pressure, rebooking-due, low-stock); missed-calls/upsell await a real source.
    aiInsights: buildAiInsights({
      peakWindowLabel: '1:00 PM - 3:00 PM', peakServiceName: 'Acrylic Full Set',
      suggestExtraTech: true, staffingWindowLabel: '1:00 PM - 4:00 PM',
      missedCalls: 6, avgBookingValueCents: 9000,
      upsellEligible: 18, rebookingDue: 12, lowStockCount: 3,
    }),
    quickActions: [
      { key: 'new_appointment', label: 'New Appointment', description: 'Book a future appointment', route: '/pos/booking' },
      { key: 'walk_in', label: 'Walk-In Check-In', description: 'Add a walk-in customer', route: '/pos/check-in' },
      { key: 'checkout', label: 'Checkout', description: 'Process payment', route: '/pos/checkout' },
    ],
  };
}

export class InMemoryDashboardRepo implements DashboardRepo {
  async getAggregate(scope: DashboardScope, q: DashboardQuery): Promise<POSDashboardState> {
    if (scope.tenantId === SEED_TENANT) return applyRange(seededDashboard(scope), q.range);
    return emptyDashboard(scope); // a different tenant sees ONLY its own (here: none)
  }
}

// Period selector for the in-memory adapter: reflect the chosen range in the period-scoped cards so the dashboard
// dropdowns produce a visibly consistent result in dev/test (the Kysely adapter windows the real SQL identically).
function applyRange(s: POSDashboardState, range?: string): POSDashboardState {
  const key: 'today' | 'week' | 'month' = range === 'today' ? 'today' : range === 'month' ? 'month' : 'week';
  const full = s.revenueTrend.series;
  const series = key === 'today' ? full.slice(-1)
    : key === 'month' ? Array.from({ length: 30 }, (_, i) => full[i % full.length]).map((p, i) => ({ ...p, label: String(i + 1) }))
    : full;
  const totalCents = series.reduce((a, x) => a + x.valueCents, 0);
  return {
    ...s,
    revenueTrend: { ...s.revenueTrend, period: key, series, totalCents },
    paymentMix: { ...s.paymentMix, period: key },
  };
}

export const DASHBOARD_SEED_TENANT = SEED_TENANT;
