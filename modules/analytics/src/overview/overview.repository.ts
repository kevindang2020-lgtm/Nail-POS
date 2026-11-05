/**
 * overview.repository.ts — repo PORT for the POS Overview aggregate + a runnable
 * in-memory implementation (seeded) for tests/dev. The production Kysely impl runs
 * the single §15 aggregate query and maps rows to PosOverviewResponse, applying
 * scoped() (WHERE tenant_id = :tenantId AND (branch_id = :branchId OR branch_id IS NULL)).
 *
 * TENANT-SAFE: scope is derived server-side from the session — never from the client.
 */
import type { PosOverviewResponse } from './overview.dto';

export interface OverviewScope {
  tenantId: string;
  branchId: string | null;
}
export interface OverviewQuery {
  date?: string;
  range?: 'today' | 'week' | 'month';
}

export interface OverviewRepo {
  /** One scoped aggregate call powers the whole page. */
  getAggregate(scope: OverviewScope, q: OverviewQuery): Promise<PosOverviewResponse>;
}

/* Kysely impl (production): a single query (CTEs/lateral joins) over appointments,
 * queue_items, tickets, payments, technician_shifts/statuses, reviews, services,
 * inventory_items — every CTE filtered by scope — then mapped to PosOverviewResponse.
 * KPI math = the dto helpers (changePercent, etc.). Insights = deterministic rules. */

export function emptyOverview(scope: OverviewScope): PosOverviewResponse {
  const zeroMoney = { amountCents: 0, displayAmount: '$0.00', changePercent: 0, comparisonLabel: 'vs yesterday' };
  const zeroCount = { count: 0, change: 0, comparisonLabel: 'vs yesterday' };
  return {
    context: { tenantId: scope.tenantId, branchId: scope.branchId || '', salonName: '', branchName: '', businessDate: '', timezone: 'America/New_York' },
    kpis: {
      todayRevenue: zeroMoney, todayCheckIns: zeroCount, walkInsToday: zeroCount, averageTicket: zeroMoney,
      waitingGuests: zeroCount, servingNow: zeroCount, readyCheckout: zeroCount,
      activeTechs: { active: 0, scheduled: 0 }, clientSatisfaction: { rating: 0, reviewCount: 0 }, onlineBookings: zeroCount,
    },
    schedulePreview: { date: '', technicians: [], openSlots: [] },
    todayAppointments: { total: 0, completed: 0, noShow: 0, cancelled: 0, remaining: 0, completedPercent: 0, completedServiceLines: 0 },
    walkInStatus: { waiting: 0, estimatedWaitMinutes: 0, checkedInNotAssigned: 0 },
    currentTicket: null,
    guestSnapshot: null,
    analytics: { revenueTrend: [], topServices: [], topTechnicians: [], paymentMix: [], quickInsights: [] },
    checkoutToday: { paidTickets: 0, tipsCents: 0, longestWaitMinutes: 0 },
  };
}

const SEED_TENANT = 'luxe001';
const SEED_BRANCH = 'br_cherryhill';

function seededOverview(scope: OverviewScope): PosOverviewResponse {
  return {
    context: { tenantId: scope.tenantId, branchId: scope.branchId || SEED_BRANCH, salonName: 'Luxe Nails & Spa', branchName: 'Cherry Hill', businessDate: '2026-06-05', timezone: 'America/New_York' },
    kpis: {
      todayRevenue: { amountCents: 846250, displayAmount: '$8,462.50', changePercent: 18.6, comparisonLabel: 'vs yesterday' },
      todayCheckIns: { count: 32, change: 4, changePercent: 14.3, comparisonLabel: 'vs yesterday' },
      walkInsToday: { count: 11, change: 2, changePercent: 22.2, comparisonLabel: 'vs yesterday' },
      averageTicket: { amountCents: 8261, displayAmount: '$82.61', changePercent: 5.2, comparisonLabel: 'vs yesterday' },
      waitingGuests: { count: 14, change: 7, comparisonLabel: 'vs yesterday' },
      servingNow: { count: 22, change: 3, comparisonLabel: 'vs yesterday' },
      readyCheckout: { count: 6, change: 2, comparisonLabel: 'vs yesterday' },
      activeTechs: { active: 10, scheduled: 16 },
      clientSatisfaction: { rating: 4.8, reviewCount: 312 },
      onlineBookings: { count: 27, change: 9, comparisonLabel: 'vs yesterday' },
    },
    schedulePreview: {
      date: '2026-06-05',
      technicians: [
        { technicianId: 'tech_samantha', name: 'Samantha Green', role: 'Nail Artist', appointments: [
          { appointmentId: 'sa_1', customerId: 'c1', customerName: 'Jessica Miller', serviceNames: ['Gel Manicure'], startTime: '14:33', endTime: '15:15', status: 'in_progress', source: 'walk_in', amountCents: 6500, durationMinutes: 45 },
          { appointmentId: 'sa_2', customerId: 'c2', customerName: 'Lisa Rodriguez', serviceNames: ['Gel Manicure'], startTime: '10:00', endTime: '10:45', status: 'completed', source: 'online_booking', amountCents: 8500, durationMinutes: 60 },
        ] },
        { technicianId: 'tech_charlotte', name: 'Charlotte Taylor', role: 'Nail Tech', appointments: [
          { appointmentId: 'sa_3', customerId: 'c3', customerName: 'Olivia Brown', serviceNames: ['Acrylic Full Set'], startTime: '14:28', endTime: '15:30', status: 'in_progress', source: 'phone', amountCents: 5000, durationMinutes: 30 },
          { appointmentId: 'sa_4', customerId: 'c4', customerName: 'Emma Wilson', serviceNames: ['Gel X Full Set'], startTime: '14:25', endTime: '15:25', status: 'waiting', source: 'online_booking', amountCents: 9500, durationMinutes: 75 },
        ] },
        { technicianId: 'tech_lily', name: 'Lily Adams', role: 'Nail Tech', appointments: [
          { appointmentId: 'sa_5', customerId: 'c5', customerName: 'Maria Garcia', serviceNames: ['Spa Pedicure'], startTime: '12:00', endTime: '12:50', status: 'in_progress', source: 'walk_in', amountCents: 7000, durationMinutes: 45 },
          { appointmentId: 'sa_6', customerId: 'c6', customerName: 'Isabella Davis', serviceNames: ['Pedicure Deluxe'], startTime: '14:21', endTime: '15:00', status: 'waiting', source: 'online_booking', amountCents: 4500, durationMinutes: 40 },
        ] },
        { technicianId: 'tech_mia', name: 'Mia Johnson', role: 'Nail Artist', appointments: [
          { appointmentId: 'sa_7', customerId: 'c7', customerName: 'Sophia Martinez', serviceNames: ['Nail Art'], startTime: '14:19', endTime: '15:00', status: 'waiting', source: 'phone', amountCents: 12000, durationMinutes: 90 },
          { appointmentId: 'sa_8', customerId: 'c8', customerName: 'Grace Kim', serviceNames: ['Spa Pedicure'], startTime: '15:00', endTime: '15:50', status: 'upcoming', source: 'walk_in', amountCents: 8000, durationMinutes: 50 },
        ] },
        { technicianId: 'tech_grace', name: 'Grace Hall', role: 'Nail Tech', appointments: [
          { appointmentId: 'sa_9', customerId: 'c9', customerName: 'Ava Thompson', serviceNames: ['Enhancements'], startTime: '14:05', endTime: '15:00', status: 'upcoming', source: 'online_booking', amountCents: 6500, durationMinutes: 45 },
        ] },
      ],
      openSlots: [{ technicianId: 'tech_grace', startTime: '18:00', endTime: '19:00' }],
    },
    todayAppointments: { total: 24, completed: 8, noShow: 1, cancelled: 2, remaining: 13, completedPercent: 33, completedServiceLines: 11 },
    walkInStatus: { waiting: 14, estimatedWaitMinutes: 35, checkedInNotAssigned: 4 },
    currentTicket: null,
    guestSnapshot: null,
    analytics: {
      revenueTrend: [
        { date: '2026-05-30', revenueCents: 360000 }, { date: '2026-05-31', revenueCents: 300000 },
        { date: '2026-06-01', revenueCents: 440000 }, { date: '2026-06-02', revenueCents: 340000 },
        { date: '2026-06-03', revenueCents: 520000 }, { date: '2026-06-04', revenueCents: 600000 },
        { date: '2026-06-05', revenueCents: 760000 },
      ],
      topServices: [
        { serviceId: 'svc_acr', serviceName: 'Acrylic Full Set', revenueCents: 1263500, count: 145 },
        { serviceId: 'svc_gel', serviceName: 'Gel Manicure', revenueCents: 987000, count: 282 },
        { serviceId: 'svc_ped', serviceName: 'Pedicure Deluxe', revenueCents: 742000, count: 124 },
        { serviceId: 'svc_bgr', serviceName: 'Builder Gel Refill', revenueCents: 621000, count: 98 },
        { serviceId: 'svc_art', serviceName: 'Nail Art Design', revenueCents: 398000, count: 61 },
      ],
      topTechnicians: [
        { technicianId: 'tech_linh', technicianName: 'Linh', revenueCents: 987000, completedServices: 41, utilizationPercent: 94 },
        { technicianId: 'tech_maria', technicianName: 'Maria', revenueCents: 924500, completedServices: 39, utilizationPercent: 88 },
        { technicianId: 'tech_vicki', technicianName: 'Vicki', revenueCents: 856000, completedServices: 37, utilizationPercent: 82 },
        { technicianId: 'tech_tiff', technicianName: 'Tiffany', revenueCents: 718500, completedServices: 31, utilizationPercent: 76 },
        { technicianId: 'tech_tony', technicianName: 'Tony', revenueCents: 642000, completedServices: 28, utilizationPercent: 75 },
      ],
      paymentMix: [
        { method: 'card', amountCents: 609300, percent: 72 },
        { method: 'cash', amountCents: 169250, percent: 20 },
        { method: 'gift_card', amountCents: 67700, percent: 8 },
      ],
      quickInsights: [
        { type: 'busiest_window', title: 'Busiest time today', value: '2PM - 6PM', severity: 'info' },
        { type: 'high_revenue_service', title: 'High revenue service', value: 'Acrylic Full Set', severity: 'success' },
        { type: 'staff_on_break', title: 'Staff on break right now', value: '5', severity: 'warning' },
        { type: 'inventory_low', title: 'Inventory low', value: '3', severity: 'danger' },
      ],
    },
    checkoutToday: { paidTickets: 41, tipsCents: 62400, longestWaitMinutes: 28 },
  };
}

/** Runnable in-memory repo: returns seeded data for the seed tenant/branch,
 *  and a valid EMPTY response for any other scope — proving tenant isolation. */
export class InMemoryOverviewRepo implements OverviewRepo {
  async getAggregate(scope: OverviewScope, _q: OverviewQuery): Promise<PosOverviewResponse> {
    if (scope.tenantId === SEED_TENANT) return seededOverview(scope);
    return emptyOverview(scope); // a different tenant sees ONLY its own (here: none)
  }
}

export const OVERVIEW_SEED_TENANT = SEED_TENANT;
