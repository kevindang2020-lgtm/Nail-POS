// super-admin-booking-checkin.service.ts — orchestrates the real aggregates into the Overview response (§38). Computes
// a current period and the immediately-preceding equal period for honest "vs previous" trends, maps raw booking sources
// into the six reference buckets (original source preserved, never overwritten), and marks sections whose dedicated
// event tables don't exist yet as available:false (honest zero) rather than fabricating data. Read-only by design:
// there are NO mutation paths here — the Super Admin monitors the flow and never acts as the salon receptionist (§boundary).
import { SuperAdminBookingCheckinKyselyRepository, type Range, type ApptFilter } from './super-admin-booking-checkin.kysely.repository';
import { parseScope, type OverviewScope } from '@aipowersalon/database';
import { pct, trend, kpiSemantic, waitStatus, fmtDuration, uptimePct, shares, stagePct, DEFAULT_WAIT_THRESHOLDS, type Semantic } from './booking-checkin-core';
import { failedEventsExportCsv, overviewExportCsv, bookingCheckinExportFilename, type BookingCheckinExportType } from './booking-checkin-export-core';

export interface AdminCtx { userId?: string; email?: string; ip?: string }

// Controlled-retry policy: capped attempts with configured exponential backoff (30s · 2^n).
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_BASE_BACKOFF_SEC = 30;
interface RetryAttemptRow { id: string; attempt_number: number; status: string; backoff_seconds: number; next_retry_at: string | null; created_at: string }
const mapAttempt = (a: RetryAttemptRow) => ({ id: a.id, attemptNumber: a.attempt_number, status: a.status, backoffSeconds: a.backoff_seconds, nextRetryAt: a.next_retry_at, createdAt: a.created_at });
export type RetryResult =
  | { ok: false; code: 'not_found'; message: string }
  | { ok: false; code: 'not_eligible'; reason: string; message: string }
  | { ok: true; eligible: true; idempotentReplay: boolean; escalated: boolean; attempt: ReturnType<typeof mapAttempt> | null; event: { retryStatus: string; retryCount: number; escalationState: string; nextRetryAt?: string } };
const BOUNDARY = 'Super Admin monitors the flow but does not act as the salon receptionist.';

const SOURCE_BUCKETS = ['online', 'ai_receptionist', 'mobile_app', 'staff_created', 'walk_in', 'kiosk'] as const;
type SourceBucket = (typeof SOURCE_BUCKETS)[number] | 'other';
function bucketSource(raw: string | null): SourceBucket {
  const s = (raw || '').toLowerCase().replace(/\s+/g, '_');
  if (s.includes('ai') || s.includes('voice') || s.includes('reception')) return 'ai_receptionist';
  if (s.includes('mobile') || s.includes('app')) return 'mobile_app';
  if (s.includes('kiosk')) return 'kiosk';
  if (s.includes('walk')) return 'walk_in';
  if (s === 'online' || s.includes('web') || s.includes('google')) return 'online';
  if (s === 'pos' || s.includes('staff') || s.includes('front') || s.includes('phone') || s.includes('desk') || s.includes('manual')) return 'staff_created';
  return 'other';
}
const SOURCE_LABEL: Record<string, string> = { online: 'Online', ai_receptionist: 'AI Receptionist', mobile_app: 'Mobile App', staff_created: 'Staff Created', walk_in: 'Walk-In', kiosk: 'Kiosk', other: 'Other' };

const CHECKIN_METHOD_LABEL: Record<string, string> = { kiosk: 'Kiosk', ipad: 'iPad', tablet: 'Tablet', front_desk: 'Front Desk', display: 'Display', qr_code: 'QR Code', unknown: 'Unknown' };
function checkinMethod(raw: string | null): string {
  const v = (raw || '').toLowerCase();
  if (['kiosk', 'browser_kiosk', 'tablet_kiosk'].includes(v)) return 'kiosk';
  if (['ipad', 'ipad_display'].includes(v)) return 'ipad';
  if (v === 'tablet') return 'tablet';
  if (['front_desk', 'front_desk_shared'].includes(v)) return 'front_desk';
  if (v === 'l_shape_display') return 'display';
  if (v === 'qr_code') return 'qr_code';
  return 'unknown';
}

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const num = (v: string | null | undefined) => Number(v ?? 0) || 0;

// Reverse of bucketSource: which raw appointment sources roll up into each reference bucket (for the Source filter).
const RAW_FOR_BUCKET: Record<string, string[]> = {
  online: ['online', 'google', 'web'],
  ai_receptionist: ['ai', 'voice'],
  mobile_app: ['customer_app', 'mobile_app', 'app'],
  staff_created: ['phone', 'pos', 'manual', 'staff', 'front_desk'],
  walk_in: ['walk_in', 'walkin'],
  kiosk: ['kiosk'],
};

export class SuperAdminBookingCheckinService {
  constructor(private readonly repo: SuperAdminBookingCheckinKyselyRepository) {}

  private bucketCounts(rowsIn: { source: string | null; count: string }[]): Record<SourceBucket, number> {
    const out: Record<string, number> = { online: 0, ai_receptionist: 0, mobile_app: 0, staff_created: 0, walk_in: 0, kiosk: 0, other: 0 };
    for (const r of rowsIn) out[bucketSource(r.source)] += num(r.count);
    return out as Record<SourceBucket, number>;
  }

  async getOverview(ctx: AdminCtx, q: any, opts?: { audit?: boolean }) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;

    // Period: [start .. end+1d). Default = today. Prior = immediately-preceding equal-length window.
    const today = startOfDay(new Date());
    const start = q?.startDate ? startOfDay(new Date(q.startDate)) : today;
    const endInclusive = q?.endDate ? startOfDay(new Date(q.endDate)) : start;
    const range: Range = { start, end: addDays(endInclusive, 1) };
    const lenDays = Math.max(1, Math.round((+range.end - +range.start) / 86400000));
    const prior: Range = { start: addDays(range.start, -lenDays), end: range.start };

    // Optional Source (reference bucket → raw sources) and Status filters, applied to the appointment-derived sections.
    const sourceBucket = typeof q?.source === 'string' && q.source && q.source !== 'all' ? q.source : null;
    const statusFilter = typeof q?.status === 'string' && q.status && q.status !== 'all' ? q.status : null;
    const apptFilter: ApptFilter = { sources: sourceBucket ? RAW_FOR_BUCKET[sourceBucket] : undefined, status: statusFilter ?? undefined };

    const [
      srcNow, srcPrev, statusNow, checkinNow, checkinPrev, queueNow,
      devices, branchWaits, trendRows, pending, integ,
      failedNow, failedPrev, dupNow, dupPrev, failedRows, handoffRows, unmatched,
    ] = await Promise.all([
      this.repo.bookingsBySource(range, scope, branchId, apptFilter),
      this.repo.bookingsBySource(prior, scope, branchId, apptFilter),
      this.repo.statusCounts(range, scope, branchId, { sources: apptFilter.sources }),
      this.repo.checkinStats(range, scope, branchId),
      this.repo.checkinStats(prior, scope, branchId),
      this.repo.queueSnapshot(range, scope, branchId),
      this.repo.deviceStatus(scope, branchId),
      this.repo.branchWaitTimes(range, scope, 5),
      this.repo.checkinTrend(scope, branchId, 7),
      this.repo.pendingConfirmations(scope, branchId, 5),
      this.repo.integrationConfig(scope),
      this.repo.failedEventCounts(range, scope, branchId),
      this.repo.failedEventCounts(prior, scope, branchId),
      this.repo.duplicateCount(range, scope, branchId),
      this.repo.duplicateCount(prior, scope, branchId),
      this.repo.failedEventRows(range, scope, branchId, 6),
      this.repo.aiHandoffRows(range, scope, branchId, 6),
      this.repo.unmatched(scope, branchId, 6),
    ]);

    const now = this.bucketCounts(srcNow);
    const prev = this.bucketCounts(srcPrev);
    const totalBookings = SOURCE_BUCKETS.reduce((a, b) => a + now[b], 0) + now.other;

    // ── Source breakdown + bookings-by-source (single reconciling population) ──
    const sourceRows = [...SOURCE_BUCKETS, 'other'].map((b) => ({ key: b, label: SOURCE_LABEL[b], count: now[b as SourceBucket] })).filter((r) => r.count > 0 || SOURCE_BUCKETS.includes(r.key as any));
    const sourceBreakdown = { total: totalBookings, rows: shares(sourceRows.filter((r) => r.key !== 'other' || r.count > 0)) };

    // ── KPI cards (real values + business-semantic trends) ──
    const kpi = (key: string, label: string, value: number, prevValue: number, opts: { available?: boolean; display?: string; href?: string } = {}) => {
      const t = trend(value, prevValue);
      const semantic: Semantic = opts.available === false ? 'neutral' : kpiSemantic(key, t.direction);
      return { key, label, value, display: opts.display ?? value.toLocaleString(), deltaPct: t.deltaPct, direction: t.direction, semantic, available: opts.available !== false, href: opts.href ?? null };
    };
    const avgCheckinSec = Math.round(Number(checkinNow.avg_seconds ?? 0)) || 0;
    const avgCheckinSecPrev = Math.round(Number(checkinPrev.avg_seconds ?? 0)) || 0;
    const deviceTotal = devices.reduce((a, d) => a + num(d.total), 0);
    const deviceOnline = devices.reduce((a, d) => a + num(d.online), 0);
    const deviceUptime = uptimePct(deviceOnline, deviceTotal);

    const kpis = [
      kpi('online_bookings', 'Online Bookings', now.online, prev.online, { href: 'booking-sources?source=online' }),
      kpi('ai_bookings', 'AI Receptionist Bookings', now.ai_receptionist, prev.ai_receptionist, { href: 'booking-sources?source=ai_receptionist' }),
      kpi('mobile_bookings', 'Mobile-App Bookings', now.mobile_app, prev.mobile_app, { href: 'booking-sources?source=mobile_app' }),
      kpi('staff_bookings', 'Staff-Created Bookings', now.staff_created, prev.staff_created, { href: 'booking-sources?source=staff_created' }),
      kpi('walk_ins', 'Walk-Ins', now.walk_in, prev.walk_in, { href: 'booking-sources?source=walk_in' }),
      kpi('kiosk_check_ins', 'Kiosk Check-Ins', num(checkinNow.started), num(checkinPrev.started), { href: 'check-in-performance?method=kiosk' }),
      kpi('failed_check_ins', 'Failed Check-Ins', num(failedNow.check_in), num(failedPrev.check_in), { href: 'failed-events?type=check_in' }),
      kpi('duplicate_check_ins', 'Duplicate Check-Ins', num(dupNow.c), num(dupPrev.c), { href: 'failed-events?type=duplicate' }),
      kpi('avg_check_in_time', 'Average Check-In Time', avgCheckinSec, avgCheckinSecPrev, { display: avgCheckinSec ? fmtDuration(avgCheckinSec) : '—', available: avgCheckinSec > 0, href: 'check-in-performance' }),
      kpi('device_status', 'Check-In Device Status', deviceUptime, 0, { display: deviceTotal ? `${deviceUptime}%` : '—', available: deviceTotal > 0, href: 'device-status' }),
      kpi('unmatched_customers', 'Unmatched Customer Records', unmatched.count, 0, {}),
      kpi('pending_confirmations', 'Bookings Waiting for Confirmation', pending.count, 0, { available: true }),
      kpi('booking_api_failures', 'Booking API Failures', num(failedNow.api), num(failedPrev.api), { href: 'failed-events?type=api' }),
    ];

    // ── Lifecycle funnel (cohort = bookings created in range) ──
    const statusMap: Record<string, number> = {};
    for (const s of statusNow) statusMap[(s.status || 'unknown').toLowerCase()] = num(s.count);
    const booked = totalBookings;
    const confirmed = (statusMap.confirmed || 0) + (statusMap.checked_in || 0) + (statusMap.in_service || 0) + (statusMap.completed || 0);
    const checkInStarted = num(checkinNow.started);
    const waiting = num(queueNow.waiting);
    const serving = num(queueNow.serving);
    const lifecycle = {
      cohort: 'bookings_created_in_range',
      stages: [
        { key: 'booked', label: 'Booked', count: booked, pct: 100 },
        { key: 'confirmed', label: 'Confirmed', count: confirmed, pct: stagePct(confirmed, booked) },
        { key: 'check_in_started', label: 'Check-In Started', count: checkInStarted, pct: stagePct(checkInStarted, booked) },
        { key: 'waiting', label: 'Waiting', count: waiting, pct: stagePct(waiting, booked) },
        { key: 'serving', label: 'Serving / In Queue', count: serving, pct: stagePct(serving, booked) },
      ],
    };

    // ── Device status panel (real heartbeat) ──
    const deviceRows = devices.map((d) => {
      const total = num(d.total), online = num(d.online);
      return { type: d.device_type || 'kiosk', online, offline: total - online, uptime: uptimePct(online, total) };
    });
    const deviceStatus = { available: deviceTotal > 0, rows: deviceRows, totalDevices: deviceTotal, totalOffline: deviceTotal - deviceOnline, overallUptime: deviceUptime };

    // ── Branch wait-time overview ──
    const branchWaitTimes = branchWaits.map((b, i) => {
      const sec = Math.round(Number(b.avg_wait_seconds ?? 0)) || 0;
      return { rank: i + 1, branchId: b.branch_id, branch: b.branch_name || '—', avgWaitSeconds: sec, avgWaitDisplay: fmtDuration(sec), bookings: num(b.bookings), checkIns: num(b.checkins), status: waitStatus(sec, DEFAULT_WAIT_THRESHOLDS) };
    });

    // ── Check-in performance trend (7d) ──
    const checkInTrend = trendRows.map((r) => ({ day: r.day, checkIns: num(r.checkins), failed: num(r.failed) }));

    // ── At-a-glance rates ──
    const avgWaitSec = Math.round(Number(queueNow.avg_wait_seconds ?? 0)) || 0;
    const queueConversion = pct(num(queueNow.entered), checkInStarted || num(checkinNow.completed));
    const confirmationRate = pct(confirmed, booked);
    const todaySummary = {
      avgWait: { seconds: avgWaitSec, display: avgWaitSec ? fmtDuration(avgWaitSec) : '—', available: avgWaitSec > 0 },
      duplicateCheckInRate: { value: pct(num(dupNow.c), num(checkinNow.started)), available: num(checkinNow.started) > 0 },
      confirmationRate: { value: confirmationRate, available: booked > 0 },
      deviceUptime: { value: deviceUptime, available: deviceTotal > 0 },
      queueConversion: { value: queueConversion, available: checkInStarted > 0 },
    };

    // ── Integration / API health (config-derived; honest about what's measurable, never exposes secrets) ──
    const integrationHealth = {
      available: num(integ.tenants) > 0,
      tenantsConfigured: num(integ.tenants),
      onlineBookingEnabled: num(integ.online),
      googleReserveConnected: num(integ.google),
      aiPhoneEnabled: num(integ.ai_phone),
      successRate24h: { value: null as number | null, available: false },   // requires a request-log table (next unit)
      failedRequests24h: { value: 0, available: false },
      retryQueue: { value: 0, available: false },
      syncIssues: { value: 0, available: false },
    };

    // ── Sections whose dedicated event tables are not yet present — honest empty (wired by later units) ──
    const failedEvents = {
      available: true,
      rows: failedRows.map((r) => ({ eventCode: r.event_code, branch: r.branch_name || '—', source: r.source || '—', failureType: r.failure_type, time: r.occurred_at, retryStatus: r.retry_status })),
    };
    const aiHandoffs = {
      available: true,
      rows: handoffRows.map((r) => ({ callCode: r.call_code, branch: r.branch_name || '—', transferredTo: r.transferred_to, reason: r.reason || '—', status: r.status, time: r.requested_at })),
    };
    const unmatchedCustomers = {
      available: true,
      rows: unmatched.rows.map((r) => ({ id: r.id, name: r.display_name || '—', source: r.source || '—', possibleMatches: r.possible_matches, lastContact: r.last_contact_at })),
    };
    const pendingConfirmations = { available: true, count: pending.count, rows: pending.rows.map((r) => ({ id: r.id, branch: r.branch_name || '—', bookedAt: r.created_at })) };

    // audit_events.tenant_id is NOT NULL, so only tenant-scoped reads are recorded here. Platform-wide (tenant-less)
    // access auditing requires a platform-level sink (existing request audit / future table) — tracked as a follow-up.
    if (scope.tenantId && opts?.audit !== false) await this.repo.writeAudit(ctx, 'overview_viewed', scope, 'Viewed Booking & Check-In Monitor overview', { branchId, range: { start: range.start, end: range.end }, scoped: true });

    return {
      ok: true,
      metadata: { generatedAt: new Date().toISOString(), range: { start: range.start.toISOString(), endInclusive: endInclusive.toISOString() }, prior: { start: prior.start.toISOString(), end: prior.end.toISOString() } },
      scope: { tenantId: scope.tenantId ?? null, branchId, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' },
      boundary: BOUNDARY,
      kpis,
      lifecycle,
      sourceBreakdown,
      bookingsBySource: sourceBreakdown.rows,
      checkInTrend,
      branchWaitTimes,
      deviceStatus,
      integrationHealth,
      pendingConfirmations,
      aiHandoffs,
      unmatchedCustomers,
      failedEvents,
      todaySummary,
    };
  }

  async getFailedEvents(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;
    const today = startOfDay(new Date());
    const start = q?.startDate ? startOfDay(new Date(q.startDate)) : addDays(today, -6); // default: last 7 days
    const endInclusive = q?.endDate ? startOfDay(new Date(q.endDate)) : today;
    const range: Range = { start, end: addDays(endInclusive, 1) };
    const page = Math.max(1, Math.min(1000, Math.round(Number(q?.page)) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.round(Number(q?.pageSize)) || 25));
    const category = typeof q?.category === 'string' && q.category && q.category !== 'all' ? q.category : null;
    const retryStatus = typeof q?.retryStatus === 'string' && q.retryStatus && q.retryStatus !== 'all' ? q.retryStatus : null;
    const search = typeof q?.search === 'string' ? q.search.trim().slice(0, 80) || null : null;

    const { rows: list, total } = await this.repo.failedEventsPage(range, scope, { branchId, category, retryStatus, search, page, pageSize });
    // Safe projection only — correlation id + retry context for diagnosis; never secrets/tokens/payment data.
    const rowsOut = list.map((r) => ({
      id: r.id, eventCode: r.event_code, branch: r.branch_name || '—', category: r.category, source: r.source || '—',
      checkInMethod: r.check_in_method || '—', failureType: r.failure_type, errorCode: r.error_code || '—',
      errorMessage: r.error_message || '—', correlationId: r.correlation_id || '—', retryStatus: r.retry_status,
      retryCount: r.retry_count, attemptCount: r.attempt_count, escalationState: r.escalation_state,
      resolution: r.resolution || '—', occurredAt: r.occurred_at, lastAttemptAt: r.last_attempt_at,
    }));
    if (scope.tenantId) await this.repo.writeAudit(ctx, 'failed_events_viewed', scope, 'Viewed Booking & Check-In failed events', { branchId, page, pageSize, category, retryStatus });
    return { ok: true, scope: { tenantId: scope.tenantId ?? null, branchId, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' }, range: { start: range.start.toISOString(), endInclusive: endInclusive.toISOString() }, page, pageSize, total, rows: rowsOut };
  }

  async getDevices(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;
    const page = Math.max(1, Math.min(1000, Math.round(Number(q?.page)) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.round(Number(q?.pageSize)) || 25));
    const status = typeof q?.status === 'string' && ['online', 'offline', 'disabled'].includes(q.status) ? q.status : null;
    const deviceType = typeof q?.deviceType === 'string' && q.deviceType && q.deviceType !== 'all' ? q.deviceType : null;
    const search = typeof q?.search === 'string' ? q.search.trim().slice(0, 80) || null : null;

    const { rows: list, total } = await this.repo.devicesPage(scope, { branchId, status, deviceType, search, page, pageSize });
    const rowsOut = list.map((r) => ({
      id: r.id, deviceName: r.device_name, deviceType: r.device_type || '—', branch: r.branch_name || '—',
      state: r.state, registeredStatus: r.status, lastSeenAt: r.last_seen_at, disabledAt: r.disabled_at, registeredAt: r.created_at,
    }));
    if (scope.tenantId) await this.repo.writeAudit(ctx, 'devices_viewed', scope, 'Viewed Booking & Check-In device status', { branchId, page, pageSize, status, deviceType });
    return { ok: true, scope: { tenantId: scope.tenantId ?? null, branchId, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' }, page, pageSize, total, rows: rowsOut };
  }

  async getHandoffs(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;
    const today = startOfDay(new Date());
    const start = q?.startDate ? startOfDay(new Date(q.startDate)) : addDays(today, -6);
    const endInclusive = q?.endDate ? startOfDay(new Date(q.endDate)) : today;
    const range: Range = { start, end: addDays(endInclusive, 1) };
    const page = Math.max(1, Math.min(1000, Math.round(Number(q?.page)) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.round(Number(q?.pageSize)) || 25));
    const status = typeof q?.status === 'string' && q.status && q.status !== 'all' ? q.status : null;
    const transferredTo = typeof q?.transferredTo === 'string' && q.transferredTo && q.transferredTo !== 'all' ? q.transferredTo : null;
    const search = typeof q?.search === 'string' ? q.search.trim().slice(0, 80) || null : null;

    const { rows: list, total } = await this.repo.handoffsPage(range, scope, { branchId, status, transferredTo, search, page, pageSize });
    // Minimal necessary detail — no call transcripts/recordings (spec safeguard).
    const rowsOut = list.map((r) => ({
      id: r.id, callCode: r.call_code, branch: r.branch_name || '—', transferredTo: r.transferred_to,
      reason: r.reason || '—', status: r.status, requestedAt: r.requested_at, connectedAt: r.connected_at,
      waitSeconds: r.wait_seconds, failureReason: r.failure_reason || '—', bookingResult: r.booking_result || '—',
    }));
    if (scope.tenantId) await this.repo.writeAudit(ctx, 'ai_handoffs_viewed', scope, 'Viewed AI receptionist handoffs', { branchId, page, pageSize, status, transferredTo });
    return { ok: true, scope: { tenantId: scope.tenantId ?? null, branchId, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' }, range: { start: range.start.toISOString(), endInclusive: endInclusive.toISOString() }, page, pageSize, total, rows: rowsOut };
  }

  async getBookingSources(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;
    const today = startOfDay(new Date());
    const start = q?.startDate ? startOfDay(new Date(q.startDate)) : addDays(today, -6); // default: last 7 days
    const endInclusive = q?.endDate ? startOfDay(new Date(q.endDate)) : today;
    const range: Range = { start, end: addDays(endInclusive, 1) };

    const [ss, failed] = await Promise.all([
      this.repo.sourceStatusCounts(range, scope, branchId),
      this.repo.failedBookingsBySource(range, scope, branchId),
    ]);

    type Agg = { total: number; confirmed: number; completed: number; cancelled: number; noShow: number; failed: number };
    const blank = (): Agg => ({ total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, failed: 0 });
    const acc: Record<string, Agg> = {};
    for (const b of [...SOURCE_BUCKETS, 'other']) acc[b] = blank();
    for (const r of ss) {
      const b = bucketSource(r.source); const n = num(r.count); const st = (r.status || '').toLowerCase();
      acc[b].total += n;
      if (['confirmed', 'checked_in', 'in_service', 'completed'].includes(st)) acc[b].confirmed += n;
      if (st === 'completed') acc[b].completed += n;
      if (st === 'cancelled') acc[b].cancelled += n;
      if (st === 'no_show') acc[b].noShow += n;
    }
    for (const r of failed) acc[bucketSource(r.source)].failed += num(r.count);

    const rowsOut = [...SOURCE_BUCKETS, 'other']
      .filter((b) => SOURCE_BUCKETS.includes(b as any) || acc[b].total > 0 || acc[b].failed > 0)
      .map((b) => {
        const a = acc[b];
        return {
          key: b, label: SOURCE_LABEL[b], total: a.total, confirmed: a.confirmed, completed: a.completed,
          cancelled: a.cancelled, noShow: a.noShow, failed: a.failed,
          confirmationRate: pct(a.confirmed, a.total), completionRate: pct(a.completed, a.total), cancellationRate: pct(a.cancelled, a.total),
        };
      })
      .sort((x, y) => y.total - x.total);

    const totals = rowsOut.reduce((t, r) => ({ total: t.total + r.total, confirmed: t.confirmed + r.confirmed, completed: t.completed + r.completed, cancelled: t.cancelled + r.cancelled, noShow: t.noShow + r.noShow, failed: t.failed + r.failed }), { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, failed: 0 });

    if (scope.tenantId) await this.repo.writeAudit(ctx, 'booking_sources_viewed', scope, 'Viewed booking source performance', { branchId });
    return { ok: true, scope: { tenantId: scope.tenantId ?? null, branchId, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' }, range: { start: range.start.toISOString(), endInclusive: endInclusive.toISOString() }, rows: rowsOut, totals };
  }

  async getCheckinPerformance(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;
    const today = startOfDay(new Date());
    const start = q?.startDate ? startOfDay(new Date(q.startDate)) : addDays(today, -6);
    const endInclusive = q?.endDate ? startOfDay(new Date(q.endDate)) : today;
    const range: Range = { start, end: addDays(endInclusive, 1) };

    const byType = await this.repo.checkinByMethod(range, scope, branchId);

    type M = { sessions: number; completed: number; expired: number; failed: number; active: number; durSum: number; durCount: number };
    const blank = (): M => ({ sessions: 0, completed: 0, expired: 0, failed: 0, active: 0, durSum: 0, durCount: 0 });
    const acc: Record<string, M> = {};
    for (const r of byType) {
      const m = checkinMethod(r.device_type);
      const a = (acc[m] ||= blank());
      const total = num(r.total), completed = num(r.completed);
      a.sessions += total; a.completed += completed; a.expired += num(r.expired); a.failed += num(r.failed); a.active += num(r.active);
      if (r.avg_dur != null && completed > 0) { a.durSum += Number(r.avg_dur) * completed; a.durCount += completed; }
    }
    const methodRows = Object.entries(acc).map(([key, a]) => {
      const avg = a.durCount > 0 ? Math.round(a.durSum / a.durCount) : 0;
      return { key, label: CHECKIN_METHOD_LABEL[key] || key, sessions: a.sessions, completed: a.completed, expired: a.expired, failed: a.failed, active: a.active, completionRate: pct(a.completed, a.sessions), avgDurationSec: avg, avgDurationDisplay: avg > 0 ? fmtDuration(avg) : '—' };
    }).sort((x, y) => y.sessions - x.sessions);

    const sum = methodRows.reduce((t, r) => ({ sessions: t.sessions + r.sessions, completed: t.completed + r.completed, expired: t.expired + r.expired, failed: t.failed + r.failed, active: t.active + r.active, durSum: t.durSum + r.avgDurationSec * r.completed, durCount: t.durCount + r.completed }), { sessions: 0, completed: 0, expired: 0, failed: 0, active: 0, durSum: 0, durCount: 0 });
    const avgAll = sum.durCount > 0 ? Math.round(sum.durSum / sum.durCount) : 0;
    const summary = { totalSessions: sum.sessions, completed: sum.completed, expired: sum.expired, failed: sum.failed, active: sum.active, completionRate: pct(sum.completed, sum.sessions), avgDurationSec: avgAll, avgDurationDisplay: avgAll > 0 ? fmtDuration(avgAll) : '—', available: sum.sessions > 0 };

    if (scope.tenantId) await this.repo.writeAudit(ctx, 'checkin_performance_viewed', scope, 'Viewed check-in performance', { branchId });
    return { ok: true, scope: { tenantId: scope.tenantId ?? null, branchId, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' }, range: { start: range.start.toISOString(), endInclusive: endInclusive.toISOString() }, summary, methods: methodRows };
  }

  async getWaitTimeAnalysis(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;
    const today = startOfDay(new Date());
    const start = q?.startDate ? startOfDay(new Date(q.startDate)) : addDays(today, -6);
    const endInclusive = q?.endDate ? startOfDay(new Date(q.endDate)) : today;
    const range: Range = { start, end: addDays(endInclusive, 1) };

    const [overall, byBranch, bySource, byHour] = await Promise.all([
      this.repo.waitTimeOverall(range, scope, branchId),
      this.repo.waitTimeByBranch(range, scope, branchId),
      this.repo.waitTimeBySource(range, scope, branchId),
      this.repo.waitTimeByHour(range, scope, branchId),
    ]);

    const sampled = num(overall.sampled);
    const entered = num(overall.entered);
    const abandoned = num(overall.abandoned);
    const secOrNull = (v: string | null) => (v == null || v === '' ? null : Math.round(Number(v)));
    const disp = (v: number | null) => (v != null && v > 0 ? fmtDuration(v) : '—');
    const avg = secOrNull(overall.avg_sec);
    const summary = {
      avgWaitSec: avg ?? 0, avgWaitDisplay: disp(avg),
      medianWaitSec: secOrNull(overall.median_sec) ?? 0, medianWaitDisplay: disp(secOrNull(overall.median_sec)),
      p90WaitSec: secOrNull(overall.p90_sec) ?? 0, p90WaitDisplay: disp(secOrNull(overall.p90_sec)),
      longestWaitSec: secOrNull(overall.longest_sec) ?? 0, longestWaitDisplay: disp(secOrNull(overall.longest_sec)),
      sampled, entered, abandoned, abandonmentRate: pct(abandoned, entered), available: sampled > 0,
    };

    const branches = byBranch.map((r) => {
      const a = secOrNull(r.avg_sec);
      return { branchId: r.branch_id, branch: r.branch || '—', avgWaitSec: a ?? 0, avgWaitDisplay: disp(a), medianWaitSec: secOrNull(r.median_sec) ?? 0, p90WaitSec: secOrNull(r.p90_sec) ?? 0, longestWaitSec: secOrNull(r.longest_sec) ?? 0, longestWaitDisplay: disp(secOrNull(r.longest_sec)), waits: num(r.waits), checkins: num(r.checkins), status: waitStatus(a ?? 0, DEFAULT_WAIT_THRESHOLDS) };
    });
    const sources = bySource.map((r) => { const a = secOrNull(r.avg_sec); return { key: bucketSource(r.source), label: SOURCE_LABEL[bucketSource(r.source)], avgWaitSec: a ?? 0, avgWaitDisplay: disp(a), waits: num(r.waits) }; });
    const hours = byHour.map((r) => ({ hour: num(r.hour), avgWaitSec: secOrNull(r.avg_sec) ?? 0, waits: num(r.waits) }));

    if (scope.tenantId) await this.repo.writeAudit(ctx, 'wait_time_viewed', scope, 'Viewed wait-time analysis', { branchId });
    return { ok: true, scope: { tenantId: scope.tenantId ?? null, branchId, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' }, range: { start: range.start.toISOString(), endInclusive: endInclusive.toISOString() }, summary, branches, sources, hours };
  }

  /**
   * Controlled, permissioned, idempotent retry of a recorded failed booking/check-in event. This is a *technical*
   * reprocessing request — it enqueues the event for the owning tenant's pipeline (status `requested`, backoff set)
   * and NEVER creates a booking/check-in/queue entry itself, so it cannot act as the receptionist or duplicate work.
   * Business records change only after a downstream worker confirms success. Idempotency is enforced at the DB level.
   */
  async retryFailedEvent(ctx: AdminCtx, id: string, body: any): Promise<RetryResult> {
    const scope: OverviewScope = parseScope(body?.tenantId);
    const ev = await this.repo.failedEventForRetry(id, scope);
    if (!ev) return { ok: false, code: 'not_found', message: 'Failed event not found in the current scope.' };

    const key = typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim().slice(0, 120) : `${ev.correlation_id || ev.id}:${ev.retry_count}`;

    // Idempotent replay FIRST: a repeated request with the same key returns the prior attempt unchanged, regardless of
    // the event's current state — so a client re-sending the same request (network retry) never double-processes.
    const existing = await this.repo.retryAttemptByKey(id, key);
    if (existing) return { ok: true, eligible: true, idempotentReplay: true, escalated: existing.status === 'escalated', attempt: mapAttempt(existing), event: { retryStatus: ev.retry_status, retryCount: ev.retry_count, escalationState: ev.escalation_state } };

    // Eligibility gate (§28). Only 'retry_available' may proceed; resolved / not_retryable / failed / already-retrying
    // are all refused. Permanent/ownership/corruption cases are represented by those non-retryable states upstream.
    if (ev.retry_status !== 'retry_available') {
      const why: Record<string, string> = { resolved: 'already resolved', not_retryable: 'not retryable', failed: 'terminally failed — requires manual review', retrying: 'a retry is already in progress' };
      return { ok: false, code: 'not_eligible', reason: ev.retry_status, message: `This event is ${why[ev.retry_status] ?? ev.retry_status} and cannot be retried.` };
    }
    if (ev.retry_count >= RETRY_MAX_ATTEMPTS) {
      return { ok: false, code: 'not_eligible', reason: 'retry_cap_reached', message: 'This event has reached the maximum retry attempts and has been escalated.' };
    }

    const attemptNumber = ev.retry_count + 1;

    const backoffSeconds = RETRY_BASE_BACKOFF_SEC * Math.pow(2, ev.retry_count);
    const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
    const willEscalate = attemptNumber >= RETRY_MAX_ATTEMPTS;

    const inserted = await this.repo.insertRetryAttempt({ tenantId: ev.tenant_id, branchId: ev.branch_id, failedEventId: id, idempotencyKey: key, attemptNumber, status: willEscalate ? 'escalated' : 'requested', backoffSeconds, nextRetryAt, requestedByUserId: ctx.userId ?? null, requestedByEmail: ctx.email ?? null, reason: typeof body?.reason === 'string' ? body.reason.slice(0, 300) : null });
    if (!inserted) {
      // Lost an insert race on the same key → treat as an idempotent replay.
      const now = await this.repo.retryAttemptByKey(id, key);
      return { ok: true, eligible: true, idempotentReplay: true, escalated: now?.status === 'escalated', attempt: now ? mapAttempt(now) : null, event: { retryStatus: ev.retry_status, retryCount: ev.retry_count, escalationState: ev.escalation_state } };
    }

    const newRetryStatus = willEscalate ? 'not_retryable' : 'retrying';
    const newEscalation = willEscalate ? 'escalated' : ev.escalation_state;
    await this.repo.bumpFailedEventRetry(id, newRetryStatus, attemptNumber, newEscalation);
    // Audited under the event's own tenant so retries are always attributable, even from platform-wide scope.
    await this.repo.writeAudit(ctx, willEscalate ? 'event_retry_escalated' : 'event_retry_requested', { tenantId: ev.tenant_id }, willEscalate ? 'Escalated failed event after reaching retry cap' : 'Requested controlled retry of failed event', { failedEventId: id, attemptNumber, backoffSeconds, idempotencyKey: key, reason: typeof body?.reason === 'string' ? body.reason.slice(0, 300) : null });

    return { ok: true, eligible: true, idempotentReplay: false, escalated: willEscalate, attempt: mapAttempt(inserted), event: { retryStatus: newRetryStatus, retryCount: attemptNumber, escalationState: newEscalation, nextRetryAt: nextRetryAt.toISOString() } };
  }

  /**
   * Server-side, authorized, audited export (§44). Reuses the injection-guarded CSV builder and exports only safe
   * columns (no secrets/tokens/payment data/unnecessary PII). Reflects the current scope + filters. CSV is produced
   * for real; XLSX/PDF are honestly reported as not-yet-available (no server-side generator exists) rather than faked.
   */
  async exportReport(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const branchId = typeof q?.branchId === 'string' && q.branchId && q.branchId !== 'all' ? q.branchId : null;
    const type: BookingCheckinExportType = q?.type === 'overview' ? 'overview' : 'failed-events';
    const rawFmt = String(q?.format || 'csv').toLowerCase();
    const format = rawFmt === 'excel' ? 'xlsx' : rawFmt;

    if (format !== 'csv') {
      if (scope.tenantId) await this.repo.writeAudit(ctx, 'export_generated', scope, `Export requested (${format}, ${type}) — format not available`, { type, format, available: false, branchId });
      return { ok: true, type, format, available: false, filename: null, csv: null, rowCount: 0, reason: `${format.toUpperCase()} export isn’t available yet — CSV is supported.` };
    }

    let csv: string;
    let rowCount: number;
    if (type === 'overview') {
      const ov = await this.getOverview(ctx, q || {}, { audit: false });
      const kpis = (ov as any).kpis ?? [];
      csv = overviewExportCsv(kpis);
      rowCount = kpis.length;
    } else {
      const today = startOfDay(new Date());
      const start = q?.startDate ? startOfDay(new Date(q.startDate)) : addDays(today, -6);
      const endInclusive = q?.endDate ? startOfDay(new Date(q.endDate)) : today;
      const range: Range = { start, end: addDays(endInclusive, 1) };
      const category = typeof q?.category === 'string' && q.category && q.category !== 'all' ? q.category : null;
      const retryStatus = typeof q?.retryStatus === 'string' && q.retryStatus && q.retryStatus !== 'all' ? q.retryStatus : null;
      const search = typeof q?.search === 'string' ? q.search.trim().slice(0, 80) || null : null;
      const { rows } = await this.repo.failedEventsPage(range, scope, { branchId, category, retryStatus, search, page: 1, pageSize: 2000 });
      csv = failedEventsExportCsv(rows.map((r) => ({ eventCode: r.event_code, branch: r.branch_name || '—', category: r.category, source: r.source || '—', checkInMethod: r.check_in_method || '—', failureType: r.failure_type, errorCode: r.error_code || '—', errorMessage: r.error_message || '—', correlationId: r.correlation_id || '—', retryStatus: r.retry_status, attemptCount: r.attempt_count, occurredAt: r.occurred_at })));
      rowCount = rows.length;
    }

    const filename = bookingCheckinExportFilename(type);
    if (scope.tenantId) await this.repo.writeAudit(ctx, 'export_generated', scope, `Exported ${type} report (csv, ${rowCount} rows)`, { type, format: 'csv', rowCount, branchId });
    return { ok: true, type, format: 'csv', available: true, filename, rowCount, csv };
  }
}
