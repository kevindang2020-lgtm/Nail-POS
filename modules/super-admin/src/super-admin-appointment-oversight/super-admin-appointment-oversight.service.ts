// super-admin-appointment-oversight.service.ts — Appointment Oversight › Overview. READ-ONLY platform monitoring
// of the appointment RECORD + LIFECYCLE across every authorized tenant/branch. It owns no new aggregation SQL of
// its own beyond the small gap repo: it COMPOSES the already-live platform aggregates (platformAppointments,
// reports, branchesDashboard, platformCustomers) and renders honest gaps for signals the schema does not yet
// instrument (failed bookings, online-booking failures, sync failures, rescheduled lifecycle events, missing
// service info, data-integrity issues, external-source errors, appointment value). This is deliberately NOT the
// Booking & Check-In Monitor (booking creation + check-in infrastructure) — that stays a separate module/route.

import type { SuperAdminPlatformService } from '../super-admin-platform/super-admin-platform.service';
import type { OverviewScope } from '@aipowersalon/database';
import type { AppointmentOversightGap } from './super-admin-appointment-oversight.kysely.repository';

export type Ctx = { userId?: string; email?: string; ip?: string };
type Gap = { available: false; reason: string };
type Kpi = { key: string; label: string; available: boolean; value: number | null; unfavorableUp?: boolean; financial?: boolean };

const gap = (reason: string): Gap => ({ available: false, reason });
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
async function settle<T>(p: Promise<T> | T): Promise<T | null> { try { return await p; } catch { return null; } }

// Friendly, mutually-exclusive source labels for pos_tech_appointments.source.
const SOURCE_LABEL: Record<string, string> = {
  online: 'Online Booking', customer_app: 'Customer App', google: 'Online Booking',
  ai: 'AI Receptionist', manual: 'Staff (Front Desk)', phone: 'Staff (Front Desk)', walk_in: 'Walk-In Added',
};
// Current-status grouping for the donut (each appointment counted once; lifecycle events are not statuses).
const STATUS_GROUP: Record<string, string> = { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-Shows' };

export class SuperAdminAppointmentOversightService {
  constructor(
    private readonly platform: SuperAdminPlatformService,
    private readonly gapRepo?: AppointmentOversightGap,
  ) {}

  // Scope-enforced, server-side appointment search. Customer phone is masked to last-4 (privacy minimization);
  // scope is server-derived (parseScope) so client param manipulation cannot widen access beyond the guard.
  async search(ctx: Ctx, scope: OverviewScope, opts: { q?: string; status?: string; source?: string; page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, rows: [] as any[] };
    const { rows, total } = await this.gapRepo.searchAppointments(sid, { ...opts, page, pageSize });
    const mask = (p: string | null) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `•••• ${d.slice(-4)}` : '••••'; };
    return {
      scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' },
      page, pageSize, total,
      rows: rows.map((r) => ({ ...r, customerPhone: mask(r.customerPhone) })),
    };
  }

  // Per-candidate duplicate detection (review-only). Same-tenant exact collisions; never auto-resolves.
  async duplicates(ctx: Ctx, scope: OverviewScope, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, groups: [] as any[] };
    const { groups, total } = await this.gapRepo.detectDuplicates(sid, page, pageSize);
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total, groups };
  }

  // Per-conflict overlap detection (review-only). Same-tenant, same-technician intersecting windows; never auto-resolves.
  async overlaps(ctx: Ctx, scope: OverviewScope, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, conflicts: [] as any[] };
    const { conflicts, total } = await this.gapRepo.detectOverlaps(sid, page, pageSize);
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total, conflicts };
  }

  // Appointment change history (immutable, read-only). Scope-enforced, newest first.
  async changeHistory(ctx: Ctx, scope: OverviewScope, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, rows: [] as any[], available: false };
    const { rows, total } = await this.gapRepo.appointmentChanges(sid, page, pageSize);
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total, rows, available: true };
  }

  // Failures & Issues (live): failed-deposit appointments — the captured failure signal. Phone masked to last-4.
  async failures(ctx: Ctx, scope: OverviewScope, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    const sources = { failedDeposits: { available: true }, failedBookings: { available: false, reason: 'no booking-attempt event log yet' }, syncFailures: { available: false, reason: 'no sync-event store yet' } };
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, rows: [] as any[], sources };
    const { rows, total } = await this.gapRepo.failedDepositAppointments(sid, page, pageSize);
    const mask = (p: string | null) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `•••• ${d.slice(-4)}` : '••••'; };
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total, rows: rows.map((r) => ({ ...r, customerPhone: mask(r.customerPhone) })), sources };
  }

  // Rescheduled appointments: the live, immutable change-log filtered to reschedule events. Reuses the same
  // append-only source as Change History — no separate store. Scope-enforced, newest first.
  async reschedules(ctx: Ctx, scope: OverviewScope, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, rows: [] as any[], available: false };
    const { rows, total } = await this.gapRepo.appointmentChanges(sid, page, pageSize, 'rescheduled');
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total, rows, available: true };
  }

  // Missing Information (live): upcoming appointments missing customer contact, with per-row missing-field flags.
  async missingInfo(ctx: Ctx, scope: OverviewScope, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, rows: [] as any[], available: false };
    const { rows, total } = await this.gapRepo.missingInfoAppointments(sid, page, pageSize);
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total, rows, available: true };
  }

  // Per-appointment lifecycle & change history: the immutable change-log for ONE appointment, across every
  // source (tech_app / check_in / booking / customer / customer_app / customer_booking), newest first.
  // Powers "Review Appointment History". Scope-enforced; empty (not error) for an unknown/invalid id.
  async appointmentHistory(ctx: Ctx, scope: OverviewScope, appointmentId: string, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 50)));
    const id = String(appointmentId ?? '').trim();
    if (!id || !this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, appointmentId: id || null, page, pageSize, total: 0, rows: [] as any[], available: !!this.gapRepo };
    const { rows, total } = await this.gapRepo.appointmentChanges(sid, page, pageSize, undefined, id);
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, appointmentId: id, page, pageSize, total, rows, available: true };
  }

  // Data Integrity (live): appointments with cross-tenant reference violations or impossible times, per-row flagged.
  async dataIntegrity(ctx: Ctx, scope: OverviewScope, opts: { page: number; pageSize: number }) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 25)));
    if (!this.gapRepo) return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total: 0, rows: [] as any[], available: false };
    const { rows, total } = await this.gapRepo.dataIntegrityIssues(sid, page, pageSize);
    return { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, page, pageSize, total, rows, available: true };
  }

  // Controlled correction — PREVIEW ONLY (read-only; no mutation).
  // Re-validates a single appointment against the data-integrity rules and, for each CONFIRMED corruption,
  // proposes the one safe, reversible correction: clear the invalid cross-tenant reference (set it to null).
  // This is deliberately NOT a generic editor — if the appointment has no detected corruption, it returns
  // eligible:false and proposes nothing. The actual apply is a separate, permission-gated, audited write
  // (not built here) that must re-validate before mutating. Scope-enforced.
  async correctionPreview(ctx: Ctx, scope: OverviewScope, appointmentId: string) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const id = String(appointmentId ?? '').trim();
    const base = { scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' }, appointmentId: id || null };
    if (!id || !this.gapRepo) return { ...base, eligible: false, reason: !id ? 'appointmentId is required' : 'unavailable', issues: [] as string[], proposals: [] as any[] };
    const { rows } = await this.gapRepo.dataIntegrityIssues(sid, 1, 1, id);
    const row = rows[0];
    if (!row || row.issues.length === 0) {
      // No detected corruption → not correctable here. Prevents using this as a back-door appointment editor.
      return { ...base, eligible: false, reason: 'No platform-level corruption detected for this appointment. Controlled correction is not a general appointment editor.', issues: [], proposals: [] };
    }
    const FIELD: Record<string, string> = { 'Invalid branch reference': 'branch_id', 'Invalid technician reference': 'technician_id', 'Invalid customer reference': 'customer_id' };
    const proposals = row.issues
      .filter((iss) => FIELD[iss])
      .map((iss) => ({
        issue: iss,
        correctionType: 'clear_invalid_reference' as const,
        field: FIELD[iss],
        before: 'a reference that does not belong to this appointment\u2019s tenant',
        after: null,
        reversible: true,
        impact: `Clears the invalid ${FIELD[iss]} pointer only; no legitimate business value is changed. The prior value is preserved in the immutable change log.`,
      }));
    const nonCorrectable = row.issues.filter((iss) => !FIELD[iss]); // e.g. impossible time — needs manual review, not an auto-clear
    return {
      ...base,
      eligible: proposals.length > 0,
      issues: row.issues,
      proposals,
      nonCorrectable,
      requiredToApply: ['caseRef', 'reason', 'confirm'],
      note: 'Preview only — no change has been made. Applying a correction is a separate permission-gated, reason-required, audited action.',
    };
  }

  async overview(ctx: Ctx, scope: OverviewScope) {
    const sid = (scope as any)?.tenantId ?? undefined;
    const g = this.gapRepo;

    const [appts, reports, branches, customers, daily, techCount, todayRevCents] = await Promise.all([
      settle(this.platform.platformAppointments({ tenantId: sid } as any)),
      settle(this.platform.reports()),
      settle(this.platform.branchesDashboard(scope as any)),
      settle(this.platform.platformCustomers({} as any)),
      settle(g?.appointmentDailyByStatus ? g.appointmentDailyByStatus(sid, 7) : Promise.resolve([])),
      settle(g?.technicianCount ? g.technicianCount(sid) : Promise.resolve(0)),
      settle(g?.todayRevenueCents ? g.todayRevenueCents(sid) : Promise.resolve(0)),
    ]);

    const kpisRaw: any = (appts as any)?.kpis ?? {};
    const byStatus: any[] = (appts as any)?.byStatus ?? [];
    const bySource: any[] = (appts as any)?.bySource ?? [];
    const oversight: any = (appts as any)?.oversight ?? {};
    const statusMap = new Map<string, number>(byStatus.map((s: any) => [String(s.status), num(s.count)]));
    const sourceMap = new Map<string, number>(bySource.map((s: any) => [String(s.source), num(s.count)]));
    const sget = (k: string) => statusMap.get(k) ?? 0;
    const staffCreated = (sourceMap.get('manual') ?? 0) + (sourceMap.get('phone') ?? 0);

    // ─────────────────────────── 18 KPI cards (honest) ───────────────────────────
    // available where a real source exists; the rest are genuine gaps (no schema source yet).
    const A = (key: string, label: string, value: number, extra: Partial<Kpi> = {}): Kpi => ({ key, label, available: true, value: num(value), ...extra });
    const G = (key: string, label: string, extra: Partial<Kpi> = {}): Kpi => ({ key, label, available: false, value: null, ...extra });

    const kpis: Kpi[] = [
      A('total', 'Total Appointments', num(kpisRaw.totalAppointments)),
      A('confirmed', 'Confirmed', sget('confirmed')),
      A('completed', 'Completed', sget('completed')),
      A('cancelled', 'Cancelled', num(kpisRaw.cancelledCount), { unfavorableUp: true }),
      A('no_shows', 'No-Shows', num(kpisRaw.noShowCount), { unfavorableUp: true }),
      A('duplicates', 'Duplicate Appointments', num(oversight.duplicateBookings), { unfavorableUp: true }),
      A('overlaps', 'Overlapping Appointments', num(oversight.technicianConflicts), { unfavorableUp: true }),
      G('failed_bookings', 'Failed Bookings', { unfavorableUp: true }),
      G('online_booking_failures', 'Online Booking Failures', { unfavorableUp: true }),
      A('ai_created', 'AI-Created Appointments', sourceMap.get('ai') ?? 0),
      A('staff_created', 'Staff-Created Appointments', staffCreated),
      G('rescheduled', 'Rescheduled Appointments'),
      G('sync_failures', 'Synchronization Failures', { unfavorableUp: true }),
      A('missing_customer', 'Missing Customer Info', num(oversight.missingContact), { unfavorableUp: true }),
      G('missing_service', 'Missing Service Info', { unfavorableUp: true }),
      G('data_integrity', 'Data Integrity Issues', { unfavorableUp: true }),
      G('external_errors', 'External Source Errors', { unfavorableUp: true }),
      G('appointment_value', 'Total Appointment Value', { financial: true }),
    ];

    // ─────────────────────────── Appointments Trend (4 series) ───────────────────────────
    const dailyArr: any[] = Array.isArray(daily) ? daily : [];
    const dateSet = Array.from(new Set(dailyArr.map((d) => String(d.date)))).sort();
    const seriesFor = (statusFilter: ((s: string) => boolean)) => dateSet.map((d) =>
      dailyArr.filter((x) => String(x.date) === d && statusFilter(String(x.status))).reduce((a, x) => a + num(x.count), 0));
    const trend = {
      available: dateSet.length > 0,
      dates: dateSet,
      series: {
        total: seriesFor(() => true),
        completed: seriesFor((s) => s === 'completed'),
        cancelled: seriesFor((s) => s === 'cancelled'),
        noShows: seriesFor((s) => s === 'no_show'),
      },
    };

    // ─────────────────────────── Status Distribution (donut) ───────────────────────────
    // Grouping (documented): confirmed→Confirmed, completed→Completed, cancelled→Cancelled, no_show→No-Shows,
    // every other current status (pending/booked/checked_in/in_service/…)→Other Issues. Each appointment once.
    const distMap = new Map<string, number>([['Confirmed', 0], ['Completed', 0], ['Cancelled', 0], ['No-Shows', 0], ['Other Issues', 0]]);
    for (const s of byStatus) { const grp = STATUS_GROUP[String(s.status)] ?? 'Other Issues'; distMap.set(grp, (distMap.get(grp) ?? 0) + num(s.count)); }
    const statusTotal = Array.from(distMap.values()).reduce((a, b) => a + b, 0);
    const statusDistribution = {
      available: byStatus.length > 0,
      total: statusTotal,
      slices: Array.from(distMap.entries()).map(([label, value]) => ({ label, value, pct: statusTotal ? Math.round((value / statusTotal) * 1000) / 10 : 0 })),
    };

    // ─────────────────────────── Appointments by Source (bars) ───────────────────────────
    const srcAgg = new Map<string, number>();
    for (const s of bySource) { const label = SOURCE_LABEL[String(s.source)] ?? 'Other'; srcAgg.set(label, (srcAgg.get(label) ?? 0) + num(s.count)); }
    const srcTotal = Array.from(srcAgg.values()).reduce((a, b) => a + b, 0);
    const sourceDistribution = {
      available: bySource.length > 0,
      total: srcTotal,
      bars: Array.from(srcAgg.entries()).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, pct: srcTotal ? Math.round((value / srcTotal) * 1000) / 10 : 0 })),
    };

    // ─────────────────────────── Recent Appointment Issues ───────────────────────────
    // Counts come from the live oversight block; per-row investigation lists are dedicated submodules
    // (Duplicates / Overlapping / Missing Information), so the Overview returns honest counts + an empty row set
    // here rather than fabricating rows. Failed-booking & sync tabs have no schema source → flagged not-connected.
    const recentIssues = {
      tabs: {
        all: num(oversight.duplicateBookings) + num(oversight.technicianConflicts) + num(oversight.missingContact),
        failedBookings: { available: false, reason: 'No failed-booking event source instrumented yet.' },
        duplicates: { available: true, count: num(oversight.duplicateBookings) },
        overlapping: { available: true, count: num(oversight.technicianConflicts) },
        syncFailures: { available: false, reason: 'No synchronization-event source instrumented yet.' },
        missingInfo: { available: true, count: num(oversight.missingContact) },
      },
      rows: [] as any[],
    };

    // ─────────────────────────── Platform summary (6 cards) ───────────────────────────
    const platformSummary = {
      totalTenants: { available: !!reports, value: num((reports as any)?.totals?.totalTenants) },
      activeBranches: { available: !!branches, value: num((branches as any)?.kpis?.activeBranches) },
      activeTechnicians: { available: Number.isFinite(Number(techCount)), value: num(techCount) },
      totalCustomers: { available: !!customers, value: num((customers as any)?.kpis?.totalCustomers) },
      todaysAppointments: { available: !!appts, value: num(kpisRaw.today) },
      todaysRevenueCents: { available: true, value: num(todayRevCents), financial: true },
    };

    return {
      metadata: { generatedAt: new Date().toISOString(), generatedBy: ctx?.userId ?? null },
      scope: { tenantId: sid ?? null, label: sid ? 'tenant' : 'platform' },
      kpis,
      trend,
      statusDistribution,
      sourceDistribution,
      recentIssues,
      platformSummary,
    };
  }
}
