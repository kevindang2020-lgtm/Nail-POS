// ai-customer-profile.service.ts — READ-ONLY intelligence layer (spec §7). It NEVER owns customer data: it calls the
// existing tenant-scoped CustomersService (detail/visits/appointments/duplicates/loyalty/membership) and turns those
// real records into honest summaries via the pure core. No new customer/dedup/appointment system is created (§3).
//
// Isolation: every call receives an AiCustomerProfileContext whose tenantId/branchId are server-derived; we forward
// that same context to CustomersService, which scopes every query by tenant (and branch). We add NO path that takes a
// customerId without the authenticated context, so there is no unsafe `WHERE id = ?` lookup (§5).
import { type CustomersService, type CustomersContext } from '@aipowersalon/customers';
import { hasPermission } from '@aipowersalon/permissions';
import type { AuditService } from '@aipowersalon/audit';
import {
  summarizeVisits, detectServicePreferences, detectTechnicianPreference,
  classifyInactivity, profileCompleteness, duplicateConfidence, rebookingOpportunity,
  evaluateChurnRisk, recommendServices, buildTimeline, aggregateTenant, type TenantScanItem,
  summarizeCalls, type CallRow, detectBranchPreference,
  DEFAULT_TUNABLES, type ProfileTunables, type VisitRecord, type AppointmentRecord,
} from './ai-customer-profile-core';
import type { AiCustomerProfileContext, Freshness, ProfileOverview } from './ai-customer-profile.dto';
import type { ServicesService } from '@aipowersalon/catalog';
import { ProfileCache } from './ai-customer-profile.cache';
import { InMemoryProfileMetrics, METRIC_FOR_ACTION, type ProfileMetrics } from './ai-customer-profile.metrics';
import { resolveSettings, PLATFORM_DEFAULTS, type ProfileSettingsLayer, type EffectiveProfileSettings } from './ai-customer-profile-settings';

// Non-view action → maps (via security-core) to customers.edit, so churn indicators are visible only to
// manage-capable roles (owner/manager), not receptionists/technicians (spec §49 "unauthorized users cannot view churn").
const CHURN = 'pos.ai_customer_profile.churn';

/**
 * Supplies the per-scope settings layers (tenant/branch/user) the gate resolves. The default impl returns none, so the
 * assistant is enabled with platform defaults. A DB-backed impl (reading a per-tenant settings table) plugs in here
 * without touching the service — enabling the §65 emergency controls (disable one tenant/branch/user).
 */
export interface ProfileSettingsPort {
  layers(ctx: AiCustomerProfileContext): Promise<{ tenant?: ProfileSettingsLayer; branch?: ProfileSettingsLayer; user?: ProfileSettingsLayer }>;
  /** Persist a per-scope override. Absent on the default (non-persistent) port. */
  setLayer?(ctx: AiCustomerProfileContext, level: 'tenant' | 'branch' | 'user', patch: ProfileSettingsLayer): Promise<void>;
}
export class DefaultProfileSettings implements ProfileSettingsPort {
  async layers(): Promise<{}> { return {}; } // enabled + platform-default tunables
}

/**
 * Supplies a customer's VERIFIED call rows (customer_id already matched) by reading the existing call-intelligence
 * events — a read-model, not a second call system (§24). The default returns none, so call summary reads as
 * NotConnected until the DB-backed port is wired. No transcript/recording is exposed here.
 */
export interface CallSummaryPort {
  customerCalls(ctx: AiCustomerProfileContext, customerId: string, limit: number): Promise<CallRow[]>;
}
export class DefaultCallSummary implements CallSummaryPort {
  async customerCalls(): Promise<CallRow[]> { return []; }
}

export class AiCustomerProfileForbiddenError extends Error {
  constructor(msg = 'Forbidden') { super(msg); this.name = 'AiCustomerProfileForbiddenError'; }
}

const VIEW = 'pos.ai_customer_profile.view';

export class AiCustomerProfileService {
  private readonly cache: ProfileCache;
  constructor(
    private readonly customers: CustomersService,
    private readonly auditSvc?: AuditService,
    private readonly services?: ServicesService,   // active-catalog for recommendations (§19); optional/degrades
    cache?: ProfileCache | null,
    private readonly settings: ProfileSettingsPort = new DefaultProfileSettings(),
    private readonly metrics: ProfileMetrics = new InMemoryProfileMetrics(),
    private readonly calls: CallSummaryPort = new DefaultCallSummary(),
    private readonly tunables: ProfileTunables = DEFAULT_TUNABLES,
  ) { this.cache = cache ?? new ProfileCache(); }

  /** Resolve effective settings for this request (platform → tenant → branch → user). */
  private async effectiveSettings(ctx: AiCustomerProfileContext): Promise<EffectiveProfileSettings> {
    const l = await this.settings.layers(ctx);
    return resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: l.tenant, branch: l.branch, user: l.user });
  }
  /** Enabled-gate → returns effective tunables, or throws AI_CUSTOMER_PROFILE_DISABLED (§64/§65 kill switches). */
  private async gate(ctx: AiCustomerProfileContext): Promise<ProfileTunables> {
    const st = await this.effectiveSettings(ctx);
    if (!st.enabled) { this.metrics.incr(ctx.tenantId, 'disabled_blocked'); throw new Error('AI_CUSTOMER_PROFILE_DISABLED'); }
    return st.tunables;
  }
  private async assertEnabled(ctx: AiCustomerProfileContext): Promise<void> { await this.gate(ctx); }
  /** Effective settings for the Settings screen (shows thresholds + which level, if any, disabled the assistant). */
  async getEffectiveSettings(ctx: AiCustomerProfileContext): Promise<EffectiveProfileSettings & { freshness: Freshness }> {
    this.need(ctx, VIEW);
    return { ...(await this.effectiveSettings(ctx)), freshness: this.fresh() };
  }

  /**
   * updateSettings (§52/§65) — persist a per-scope override (enable/disable + tunables). Manage-gated. Requires the
   * settings port to support persistence (the DB-backed port); the default in-memory port is read-only. Invalidates
   * the tenant's cached summaries so a changed threshold / kill switch takes effect immediately.
   */
  async updateSettings(ctx: AiCustomerProfileContext, level: 'tenant' | 'branch' | 'user', patch: ProfileSettingsLayer) {
    this.need(ctx, CHURN); // manage-level capability (maps to customers.edit)
    if (!this.settings.setLayer) throw new Error('SETTINGS_NOT_PERSISTED');
    if (level === 'branch' && !ctx.branchId) throw new Error('BRANCH_NOT_AUTHORIZED');
    await this.settings.setLayer(ctx, level, patch);
    await this.cache.invalidateTenant(ctx.tenantId);
    this.audit(ctx, 'ai_profile_settings_updated', undefined, { level, enabled: patch.enabled });
    return { ...(await this.effectiveSettings(ctx)), freshness: this.fresh() };
  }

  /** Invalidate all cached summaries for one tenant — call on customer/appointment/membership/loyalty/consent change,
   *  merge, or deletion (§38). Wired to mutation points in Stage 3 alongside the merge action. */
  async invalidateTenant(tenantId: string): Promise<void> { await this.cache.invalidateTenant(tenantId); }

  // The AI Customer Profile context IS the customers context (same server-derived fields).
  private cust(ctx: AiCustomerProfileContext): CustomersContext { return ctx as unknown as CustomersContext; }
  private need(ctx: AiCustomerProfileContext, perm: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new AiCustomerProfileForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, perm)) { this.metrics.incr(ctx.tenantId, 'permission_denied'); throw new AiCustomerProfileForbiddenError('Missing ' + perm); }
  }
  private fresh(): Freshness { return { generatedAt: new Date().toISOString(), source: 'live' }; }
  private audit(ctx: AiCustomerProfileContext, action: string, customerId?: string, meta?: Record<string, unknown>) {
    void this.auditSvc?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'ai_customer_profile', action, resourceType: 'pos_customer', resourceId: customerId, metadata: meta },
    );
    this.metrics.incr(ctx.tenantId, METRIC_FOR_ACTION[action] ?? action); // §58 usage metering
  }

  /** getUsage (§58) — per-tenant usage counters for the AI Usage surface. Manage-gated. */
  async getUsage(ctx: AiCustomerProfileContext) {
    this.need(ctx, CHURN);
    return { usage: await this.metrics.snapshot(ctx.tenantId), freshness: this.fresh() };
  }

  /** Pull the real, tenant-scoped records once and shape them for the pure core. */
  private async load(ctx: AiCustomerProfileContext, customerId: string) {
    const c = this.cust(ctx);
    const [detail, visitsRaw, apptsRaw] = await Promise.all([
      this.customers.detail(c, customerId),
      this.customers.visits(c, customerId),
      this.customers.appointments(c, customerId),
    ]);
    const visits: VisitRecord[] = visitsRaw.map(v => ({
      date: v.date, serviceName: v.serviceName, technicianName: v.technicianName,
      totalCents: v.totalCents, tipCents: v.tipCents,
      // requestedTechnician is only set when the domain records an explicit request; unknown => false (§12 honest).
    }));
    const appts: AppointmentRecord[] = apptsRaw.map(a => ({
      startsAt: a.startsAt, serviceName: a.serviceName, technicianName: a.technicianName, status: a.status,
    }));
    return { detail, visits, appts };
  }

  // ---- authorized tools (all read-only) ----

  /** get_customer_visit_summary (§10) */
  async visitSummary(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    const t = await this.gate(ctx);
    this.audit(ctx, 'ai_profile_visit_summary_viewed', customerId);
    const cached = await this.cache.get<any>(ctx, customerId, 'visit-summary');
    if (cached) return { ...cached, freshness: { generatedAt: new Date().toISOString(), source: 'cache' as const } };
    const { visits, appts } = await this.load(ctx, customerId);
    const vs = summarizeVisits(visits, appts, new Date().toISOString(), 0, t);
    await this.cache.set(ctx, customerId, 'visit-summary', vs);
    return { ...vs, freshness: this.fresh() };
  }

  /** evaluate_customer_churn_risk (§15/§33) — manage-gated; ranges not certainties. */
  async churnRisk(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, CHURN);
    const t = await this.gate(ctx);
    const { visits, appts } = await this.load(ctx, customerId);
    const now = new Date().toISOString();
    const vs = summarizeVisits(visits, appts, now, 0, t);
    let membershipCanceled = false;
    try { membershipCanceled = ((await this.customers.getMembership(this.cust(ctx), customerId)) as any)?.status === 'cancelled'; } catch { /* membership unavailable → treat as unknown/false */ }
    const inact = classifyInactivity(vs.lastVisit, vs.typicalIntervalDays, vs.upcomingCount > 0, vs.completedVisits, now, t);
    this.audit(ctx, 'ai_profile_churn_viewed', customerId, { level: undefined });
    return {
      ...evaluateChurnRisk({
        completedVisits: vs.completedVisits,
        daysSinceLastVisit: inact.daysSinceLastVisit,
        typicalIntervalDays: vs.typicalIntervalDays,
        hasFutureAppointment: vs.upcomingCount > 0,
        canceledCount: vs.canceledCount,
        noShowCount: vs.noShowCount,
        membershipCanceled,
        unresolvedFollowUp: false, // no authoritative open-follow-up source wired yet (Stage 3 comms integration)
      }, t),
      freshness: this.fresh(),
    };
  }

  /** recommend_customer_services (§19) — intersects real history with the ACTIVE tenant catalog. */
  async serviceRecommendations(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    const t = await this.gate(ctx);
    const { visits } = await this.load(ctx, customerId);
    let activeNames: Set<string> | null = null;
    try {
      const list = this.services ? await this.services.list(ctx as any) : null;
      if (list) activeNames = new Set(((list as any).items ?? []).filter((s: any) => (s.status ?? 'active') === 'active').map((s: any) => s.name));
    } catch { activeNames = null; } // caller lacks services.view → degrade to rebook-usual only, availability unconfirmed
    this.audit(ctx, 'ai_profile_recommendations_viewed', customerId);
    return { recommendations: recommendServices(visits, activeNames, new Date().toISOString(), t), catalogAvailable: activeNames !== null, freshness: this.fresh() };
  }

  /** recommend_customer_rebooking (§21) — advisory only; actual availability/booking is deferred to AI Booking (§26). */
  async rebooking(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    const t = await this.gate(ctx);
    const { visits, appts } = await this.load(ctx, customerId);
    const now = new Date().toISOString();
    const vs = summarizeVisits(visits, appts, now, 0, t);
    const inact = classifyInactivity(vs.lastVisit, vs.typicalIntervalDays, vs.upcomingCount > 0, vs.completedVisits, now, t);
    const lastService = visits.length ? [...visits].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0].serviceName : null;
    this.audit(ctx, 'ai_profile_rebooking_viewed', customerId);
    return {
      ...rebookingOpportunity(inact, vs.upcomingCount > 0, false, vs.typicalIntervalDays),
      lastService, lastVisit: vs.lastVisit, typicalIntervalDays: vs.typicalIntervalDays,
      nextAppointment: vs.nextAppointment,
      bookingHandoff: 'AI Booking Assistant', // no auto-book; §21 requires confirmation through booking tools
      freshness: this.fresh(),
    };
  }

  /** get_customer_timeline (§23) — unified, bounded, cursor-paginated customer history. Read-only. */
  async timeline(ctx: AiCustomerProfileContext, customerId: string, opts: { limit?: number; before?: string | null } = {}) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const { visits, appts } = await this.load(ctx, customerId);
    this.audit(ctx, 'ai_profile_timeline_viewed', customerId, { limit: opts.limit, paged: !!opts.before });
    return { ...buildTimeline(visits, appts, new Date().toISOString(), opts), freshness: this.fresh() };
  }

  /** get_customer_service_preferences (§11) */
  async servicePreferences(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    const t = await this.gate(ctx);
    const { visits } = await this.load(ctx, customerId);
    this.audit(ctx, 'ai_profile_service_prefs_viewed', customerId);
    return { preferences: detectServicePreferences(visits, new Date().toISOString(), t), freshness: this.fresh() };
  }

  /** get_customer_technician_preferences (§12) */
  async technicianPreference(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    const t = await this.gate(ctx);
    const { visits } = await this.load(ctx, customerId);
    this.audit(ctx, 'ai_profile_tech_pref_viewed', customerId);
    return { preference: detectTechnicianPreference(visits, t), freshness: this.fresh() };
  }

  /** get_customer_branch_preferences (§13) — infers from actual per-visit branches (now available), falling back to
   *  the saved preferred branch. */
  async branchPreference(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const [d, visitsRaw] = await Promise.all([
      this.customers.detail(this.cust(ctx), customerId),
      this.customers.visits(this.cust(ctx), customerId).catch(() => [] as any[]),
    ]);
    const dd: any = d;
    const saved = dd.preferredBranchName ?? dd.branchName ?? dd.primaryBranch ?? null;
    const visitBranches = ((visitsRaw as any[]) || []).map(v => v.branchName).filter(Boolean) as string[];
    this.audit(ctx, 'ai_profile_branch_pref_viewed', customerId);
    return { ...detectBranchPreference(saved, visitBranches), freshness: this.fresh() };
  }

  /** detect_customer_inactivity (§14) */
  async inactivity(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    const t = await this.gate(ctx);
    const { visits, appts } = await this.load(ctx, customerId);
    const now = new Date().toISOString();
    const vs = summarizeVisits(visits, appts, now, 0, t);
    this.audit(ctx, 'ai_profile_inactivity_viewed', customerId);
    return { ...classifyInactivity(vs.lastVisit, vs.typicalIntervalDays, vs.upcomingCount > 0, vs.completedVisits, now, t), freshness: this.fresh() };
  }

  /** get_customer_profile_completeness (§18) — data quality only */
  async completeness(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const detail = await this.customers.detail(this.cust(ctx), customerId);
    const d: any = detail;
    this.audit(ctx, 'ai_profile_completeness_viewed', customerId);
    return {
      ...profileCompleteness({
        firstName: d.firstName ?? null, lastName: d.lastName ?? null,
        phone: d.phone ?? null, email: d.email ?? null,
        preferredLanguage: d.preferredLanguage ?? null, birthday: d.birthday ?? null,
        smsConsentKnown: d.smsOptIn !== undefined || d.marketingOptIn !== undefined,
        preferredBranchKnown: !!(d.preferredBranchId || d.branchId),
      }),
      freshness: this.fresh(),
    };
  }

  /** find_duplicate_customer_candidates (§16) — REUSES the existing dedup service; adds a confidence label only. */
  async duplicates(ctx: AiCustomerProfileContext) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const groups = await this.customers.duplicates(this.cust(ctx)); // tenant-scoped by CustomersService
    this.audit(ctx, 'ai_profile_duplicates_viewed', undefined, { groups: groups.length });
    return {
      groups: groups.map(g => {
        const phones = new Set(g.members.map(m => m.phone).filter(Boolean));
        const emails = new Set(g.members.map(m => m.email).filter(Boolean));
        const lastNames = new Set(g.members.map(m => (m.displayName || '').split(' ').at(-1)));
        return {
          duplicateGroupId: g.duplicateGroupId,
          reason: g.reason,
          confidence: duplicateConfidence(g.reason, phones.size === 1 && phones.size > 0, emails.size === 1 && emails.size > 0, lastNames.size === 1),
          members: g.members,
          notSure: !!(g as any).notSure,   // Functional Decision 29: staff marked this group Not Sure
        };
      }),
      freshness: this.fresh(),
    };
  }

  /** get_customer_profile_context (§9 overview) — the assembled headline card. */
  async overview(ctx: AiCustomerProfileContext, customerId: string): Promise<ProfileOverview> {
    this.need(ctx, VIEW);                                   // permission ALWAYS enforced, never bypassed by cache
    const t = await this.gate(ctx);
    this.audit(ctx, 'ai_profile_overview_viewed', customerId);
    const cached = await this.cache.get<ProfileOverview>(ctx, customerId, 'overview');
    if (cached) return { ...cached, freshness: { generatedAt: new Date().toISOString(), source: 'cache' } };
    const fresh = await this.computeOverview(ctx, customerId, t);
    await this.cache.set(ctx, customerId, 'overview', fresh);
    return fresh;
  }

  private async computeOverview(ctx: AiCustomerProfileContext, customerId: string, t: ProfileTunables): Promise<ProfileOverview> {
    const { detail, visits, appts } = await this.load(ctx, customerId);
    const now = new Date().toISOString();
    const vs = summarizeVisits(visits, appts, now, 0, t);
    const svc = detectServicePreferences(visits, now, t);
    const tech = detectTechnicianPreference(visits, t);
    const inact = classifyInactivity(vs.lastVisit, vs.typicalIntervalDays, vs.upcomingCount > 0, vs.completedVisits, now, t);
    const rb = rebookingOpportunity(inact, vs.upcomingCount > 0, false, vs.typicalIntervalDays);
    const d: any = detail;
    return {
      customerId,
      displayName: d.displayName ?? d.fullName ?? [d.firstName, d.lastName].filter(Boolean).join(' ') ?? '',
      status: d.status ?? 'active',
      lastVisit: vs.lastVisit,
      nextAppointment: vs.nextAppointment,
      completedVisits: vs.completedVisits,
      mostBookedService: svc.length ? svc[0].serviceName : null,
      likelyTechnician: tech && tech.confidence !== 'insufficient' ? tech.technicianName : null,
      membershipStatus: d.membershipStatus ?? d.membership?.status ?? 'none',
      loyaltySummary: d.loyaltyTier ?? (d.loyaltyPoints != null ? `${d.loyaltyPoints} pts` : '\u2014'),
      completenessPercent: (await this.completeness(ctx, customerId)).percent,
      inactivityStatus: inact.status,
      duplicateWarning: false, // filled by the Duplicate Review page; overview stays cheap (no tenant-wide scan here)
      rebookingEligible: rb.eligible,
      freshness: this.fresh(),
    };
  }

  // ============================ STAGE 3 ============================

  /** request_customer_merge (§16/§47) — READ-ONLY preview of a merge. Shows surviving record + what moves. Never mutates. */
  async mergePreview(ctx: AiCustomerProfileContext, groupId: string, primaryCustomerId: string) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const groups = await this.customers.duplicates(this.cust(ctx)); // tenant-scoped
    const group = groups.find(g => g.duplicateGroupId === groupId);
    if (!group) throw new Error('CUSTOMER_NOT_FOUND');
    const primary = group.members.find(m => m.customerId === primaryCustomerId) ?? null;
    if (!primary) throw new Error('DUPLICATE_REVIEW_REQUIRED'); // primary must be one of the group members
    const others = group.members.filter(m => m.customerId !== primaryCustomerId);
    const fieldSet = (k: 'phone' | 'email') => new Set(group.members.map(m => (m as any)[k]).filter(Boolean));
    this.audit(ctx, 'ai_profile_merge_previewed', primaryCustomerId, { groupId, members: group.members.length });
    return {
      groupId, reason: group.reason,
      survivingRecord: primary,
      mergingRecords: others,
      matchingFields: { phone: fieldSet('phone').size === 1, email: fieldSet('email').size === 1 },
      willMove: ['appointment & service history', 'loyalty points', 'tags', 'notes'], // per customers merge behaviour
      confirmationRequired: true,     // §7: never auto-merge; execution is a separate confirmed call
      permissionRequired: 'pos.customers.merge',
      freshness: this.fresh(),
    };
  }

  /**
   * request_customer_merge EXECUTION (§16) — mutation. Requires explicit confirm=true AND the elevated
   * pos.customers.merge permission (enforced inside customers.merge). Delegates to the authoritative merge service,
   * then invalidates this tenant's cached summaries. Audited on both sides.
   */
  async merge(ctx: AiCustomerProfileContext, groupId: string, primaryCustomerId: string, confirm: boolean) {
    if (confirm !== true) throw new Error('DUPLICATE_REVIEW_REQUIRED'); // no execution without explicit confirmation
    await this.assertEnabled(ctx);
    // customers.merge enforces pos.customers.merge + validates the primary; it is the sole system of record for merges.
    const merged = await this.customers.merge(this.cust(ctx), groupId, primaryCustomerId);
    await this.cache.invalidateTenant(ctx.tenantId); // §38: invalidate on merge
    this.audit(ctx, 'ai_profile_merge_executed', primaryCustomerId, { groupId });
    return { merged, invalidatedCache: true, freshness: this.fresh() };
  }

  /**
   * copilotContext (§25) — the single shared entry point the Reception Copilot calls instead of re-deriving customer
   * intelligence. Read-only. `recentCall`/`callSummaryConnected` are honestly null/false until a per-customer call read
   * is exposed by call-intelligence (Stage 3.1) — never fabricated.
   */
  async copilotContext(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const [overview, svc, tech, inact, rb, call] = await Promise.all([
      this.overview(ctx, customerId),
      this.servicePreferences(ctx, customerId),
      this.technicianPreference(ctx, customerId),
      this.inactivity(ctx, customerId),
      this.rebooking(ctx, customerId),
      this.callSummary(ctx, customerId).catch(() => ({ connected: false, lastCall: null } as any)),
    ]);
    return {
      overview,
      likelyService: svc.preferences[0] ?? null,
      likelyTechnician: tech.preference,
      inactivity: inact,
      rebooking: rb,
      recentCall: call.lastCall ?? null,        // verified AI Phone call, when present
      callSummaryConnected: call.connected ?? false, // honest: false when no call data / port not wired
      freshness: this.fresh(),
    };
  }

  /** get_customer_call_summary (§24) — verified AI Phone call summary. No transcript/recording is exposed here. */
  async callSummary(ctx: AiCustomerProfileContext, customerId: string) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const rows = await this.calls.customerCalls(ctx, customerId, 20).catch(() => [] as CallRow[]);
    this.audit(ctx, 'ai_profile_call_summary_viewed', customerId);
    return { ...summarizeCalls(rows), freshness: this.fresh() };
  }

  /**
   * refreshTenantOverview (§39/§44) — bounded, tenant-scoped precompute for the Customer Intelligence Overview.
   * Worker-ready: a future per-tenant scheduler simply calls this. Reuses existing tenant-scoped reads; caches the
   * aggregate so the overview screen is cheap. Idempotent (recompute overwrites the cached aggregate).
   */
  async refreshTenantOverview(ctx: AiCustomerProfileContext) {
    this.need(ctx, VIEW);
    const t = await this.gate(ctx);
    const c = this.cust(ctx);
    const SCAN_CAP = 300; // bounded so one tenant can't monopolize the worker/DB (§40/§41)
    const list: any = await this.customers.list(c, {} as any).catch(() => ({ items: [] }));
    const allItems: any[] = list.items || [];
    const ids = allItems.slice(0, SCAN_CAP).map((i: any) => i.customerId).filter(Boolean);

    const scan: TenantScanItem[] = [];
    for (const id of ids) {
      const [visitsRaw, apptsRaw] = await Promise.all([
        this.customers.visits(c, id).catch(() => [] as any[]),
        this.customers.appointments(c, id).catch(() => [] as any[]),
      ]);
      scan.push({
        visits: (visitsRaw as any[]).map(v => ({ date: v.date, serviceName: v.serviceName, technicianName: v.technicianName, totalCents: v.totalCents, tipCents: v.tipCents })),
        appointments: (apptsRaw as any[]).map(a => ({ startsAt: a.startsAt, serviceName: a.serviceName, technicianName: a.technicianName, status: a.status })),
      });
    }
    const now = new Date().toISOString();
    const tenantAgg = aggregateTenant(scan, now, t);
    const dupGroups = await this.customers.duplicates(c).catch(() => [] as any[]);
    const aggregate = {
      ...tenantAgg,
      duplicateCandidateGroups: dupGroups.length,
      scanCap: SCAN_CAP,
      truncated: allItems.length > SCAN_CAP,
      generatedAt: now,
    };
    await this.cache.set(ctx, '__tenant__', 'tenant-overview', aggregate);
    this.audit(ctx, 'ai_profile_tenant_overview_refreshed', undefined, { scanned: scan.length, duplicateGroups: dupGroups.length });
    return { ...aggregate, freshness: this.fresh() };
  }

  /** tenantOverview (§44) — cached aggregate if fresh, else computed on demand. */
  async tenantOverview(ctx: AiCustomerProfileContext) {
    this.need(ctx, VIEW);
    await this.assertEnabled(ctx);
    const cached = await this.cache.get<any>(ctx, '__tenant__', 'tenant-overview');
    if (cached) return { ...cached, freshness: { generatedAt: new Date().toISOString(), source: 'cache' as const } };
    return this.refreshTenantOverview(ctx);
  }
}
