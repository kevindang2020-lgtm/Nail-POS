// owner-portfolio-core.ts — one owner, many salons.
//
// ── The architecture, and why ──
//
// A **salon is a tenant**: it has its own Store Code (`tenants.tenant_code`), its own subscription, its own
// merchant account, its own legal name and tax entity. Those are separate legal businesses, and merging them into
// one tenant to make switching easier would merge their merchant accounts and subscriptions with them.
//
// A **branch is a location** within one salon (Luxe Nails — Downtown / Marlton).
//
// The **portfolio already exists**: `user_branch_access` carries `tenant_id` per row, so one user can already be
// granted access across tenants. There is deliberately no `owner_portfolios` table — the canonical model is
// already in the schema, and duplicating it would create two sources of truth for who may see what.
//
// ── What was actually missing ──
//
// Every Owner App query is hard-scoped to the session's single `tenantId` (93 of them), and owner login requires a
// Store Code — which pins the session to one salon. So an owner with three salons had to **sign out and back in
// with a different Store Code** to see each one. The grants existed; nothing ever read them across tenants.
//
// ── The security rule ──
//
// A salon switch is a REQUEST, never an authorization. The client says "switch me to salon X"; the server decides
// whether that owner holds an active membership there, and re-issues the session for the salon it approved. A
// tampered `tenantId` cannot get an owner into a salon they do not own, because the server never takes the tenant
// from the client — only a lookup key.

/** How much this owner may do at ONE salon. Evaluated per salon — never inherited from another. */
export type SalonAccessLevel = 'owner' | 'manager' | 'viewer' | 'report_only';

export const ACCESS_LEVELS: SalonAccessLevel[] = ['owner', 'manager', 'viewer', 'report_only'];

export interface PortfolioBranch {
  branchId: string;
  name: string;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

/** One salon in the owner's portfolio, as resolved from their memberships. */
export interface PortfolioSalon {
  tenantId: string;
  salonName: string;
  storeCode: string;
  tenantStatus: string;
  accessLevel: SalonAccessLevel;
  isPrimaryOwner: boolean;
  branches: PortfolioBranch[];
}

export interface OwnerPortfolio {
  ownerUserId: string;
  salons: PortfolioSalon[];
}

/** A salon is shown even when inactive, but cannot be switched into. */
export function isSalonSelectable(s: Pick<PortfolioSalon, 'tenantStatus'>): boolean {
  return String(s.tenantStatus || '').toLowerCase() === 'active';
}

export type SwitchDecision =
  | { ok: true; tenantId: string; branchId: string | null; accessLevel: SalonAccessLevel }
  | { ok: false; reason: 'not_a_member' | 'salon_inactive' | 'branch_not_in_salon' | 'branch_inactive'; message: string };

/**
 * May this owner switch to this salon (and optionally a branch inside it)?
 *
 * Takes the portfolio the SERVER resolved — never anything the client sent. The requested tenantId is used only to
 * LOOK UP a membership; it never becomes the answer.
 */
export function decideSwitch(
  portfolio: OwnerPortfolio,
  requestedTenantId: string,
  requestedBranchId?: string | null,
): SwitchDecision {
  const salon = portfolio.salons.find((s) => s.tenantId === requestedTenantId);

  // Not a member. The message is identical to "no such salon" — an owner must not be able to probe which salons
  // exist on the platform by watching the error change.
  if (!salon) {
    return { ok: false, reason: 'not_a_member', message: 'That salon is not available for your account.' };
  }
  if (!isSalonSelectable(salon)) {
    return { ok: false, reason: 'salon_inactive', message: 'That salon is not currently active.' };
  }

  if (requestedBranchId) {
    const branch = salon.branches.find((b) => b.branchId === requestedBranchId);
    // A branch id belonging to ANOTHER salon must not smuggle a cross-tenant context through.
    if (!branch) {
      return { ok: false, reason: 'branch_not_in_salon', message: 'That location is not available for your account.' };
    }
    if (!branch.isActive) {
      return { ok: false, reason: 'branch_inactive', message: 'That location is not currently active.' };
    }
    return { ok: true, tenantId: salon.tenantId, branchId: branch.branchId, accessLevel: salon.accessLevel };
  }

  return { ok: true, tenantId: salon.tenantId, branchId: null, accessLevel: salon.accessLevel };
}

// ── Permissions are PER SALON ──
//
// An owner may edit payroll at Salon A and be report-only at Salon B. Taking the highest level they hold anywhere
// would silently grant write access at a salon where they were deliberately given none.

const CAPABILITIES: Record<SalonAccessLevel, string[]> = {
  owner:       ['view', 'reports', 'operate', 'manage_staff', 'manage_settings', 'manage_payments', 'payroll'],
  manager:     ['view', 'reports', 'operate', 'manage_staff'],
  viewer:      ['view', 'reports'],
  report_only: ['reports'],
};

export function canAtSalon(level: SalonAccessLevel, capability: string): boolean {
  return (CAPABILITIES[level] ?? []).includes(capability);
}

/** Resolves the level for THIS salon. Never takes a level from the client, never falls back to a better one held
 *  elsewhere in the portfolio. */
export function canAt(portfolio: OwnerPortfolio, tenantId: string, capability: string): boolean {
  const salon = portfolio.salons.find((s) => s.tenantId === tenantId);
  if (!salon) return false;                      // not a member → nothing, whatever they hold elsewhere
  if (!isSalonSelectable(salon)) return false;   // inactive salon → nothing
  return canAtSalon(salon.accessLevel, capability);
}

// ── Aggregation ──

export interface SalonTotals {
  tenantId: string;
  appointmentsToday: number;
  // The canonical POS workflow: check-in → in service → service done → ready for checkout → completed.
  // These are read from `pos_queue_items`, the live queue — not invented, and not derived from appointments,
  // which would double-count a walk-in who never had one.
  checkedIn: number;
  customersWaiting: number;
  servicesInProgress: number;
  readyForCheckout: number;
  techniciansWorking: number;
  newClientsToday: number;
  revenueTodayCents: number;
  revenueMonthCents: number;
  tipsTodayCents: number;
  // YESTERDAY, same salon, same refund-netting. These exist so the change percentages on the dashboard can be
  // COMPUTED rather than invented. Before this they were simply absent from the UI — which was the right call,
  // because the alternative was typing a number into a screen that reports money.
  revenueYesterdayCents: number;
  tipsYesterdayCents: number;
  appointmentsYesterday: number;
  checkedInYesterday: number;
  newClientsYesterday: number;
  /** A live AI receptionist agent at this salon. Null when the salon has none — NOT "offline", which would imply
   *  something is wrong rather than that it was never set up. */
  aiReceptionistLive: boolean | null;
}

/**
 * Percent change vs the previous period, or NULL when it cannot honestly be stated.
 *
 * `null` — not 0, not Infinity, not "+100%" — when the baseline is 0. A salon that took nothing yesterday and
 * $5,000 today did not grow by any percentage; the comparison is undefined, and the card must say nothing
 * rather than print a number that means nothing. Same when the baseline is missing entirely.
 *
 * Returned as a rounded 1-decimal figure so the UI never has to do arithmetic on money.
 */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;                       // undefined, not infinite
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** One hour of the Revenue Overview chart. Integer cents, refund-netted. */
export interface RevenuePoint { hour: number; revenueCents: number }

export interface PortfolioSummary {
  totalSalons: number;
  activeSalons: number;
  totalBranches: number;
  appointmentsToday: number;
  checkedIn: number;
  customersWaiting: number;
  servicesInProgress: number;
  readyForCheckout: number;
  techniciansWorking: number;
  newClientsToday: number;
  revenueTodayCents: number;
  revenueMonthCents: number;
  tipsTodayCents: number;
  /**
   * AI Receptionist across the portfolio. Reported HONESTLY:
   *   live      — every salon that has one has it running
   *   degraded  — some salons have one running and some do not
   *   none      — no salon has one configured
   * Never "Online" when it is not, and never "Offline" for a salon that simply never set one up.
   */
  aiReceptionist: 'live' | 'degraded' | 'none';
  /** Salons whose figures the owner may NOT see. Reported honestly rather than silently added as zero. */
  salonsWithheldForPermission: number;
  /** Change vs YESTERDAY. Each is a percentage, or NULL when there is no baseline to compare against —
   *  never 0-as-unknown, and never a fabricated figure to fill the card. */
  changes: {
    revenueTodayPct: number | null;
    tipsTodayPct: number | null;
    appointmentsPct: number | null;
    checkedInPct: number | null;
    newClientsPct: number | null;
  };
}

/**
 * Aggregate across ONLY the salons this owner may see figures for.
 *
 * Money stays in **integer cents** throughout — a portfolio sums many salons, and floats drift.
 *
 * A salon the owner can see but lacks reporting permission for is **counted as withheld, not as zero**. Silently
 * contributing 0 would make a portfolio total look precise while being wrong — worse than saying plainly that
 * some salons are not included.
 */
/**
 * Top Performing Salons — the ranked list on the All Salons dashboard.
 *
 * PURE, and permission-scoped the same way `summarize()` is: a salon the owner may not see figures for is not
 * ranked, not counted, and not even named here. That is the difference between "the owner's portfolio ranked"
 * and a platform-wide leaderboard, which this must never become — an owner with report-only access at one salon
 * has no business learning another owner's revenue from a ranking.
 *
 * Revenue is already refund-netted by the repository, in integer cents.
 */
export function topSalons(
  portfolio: OwnerPortfolio,
  totals: SalonTotals[],
  limit = 5,
): { rank: number; tenantId: string; salonName: string; revenueTodayCents: number }[] {
  const byTenant = new Map(totals.map((t) => [t.tenantId, t]));

  return portfolio.salons
    .filter((s) => isSalonSelectable(s) && canAtSalon(s.accessLevel, 'reports') && byTenant.has(s.tenantId))
    .map((s) => ({
      tenantId: s.tenantId,
      salonName: s.salonName,
      revenueTodayCents: byTenant.get(s.tenantId)!.revenueTodayCents,
    }))
    // Ties broken by name so the order is stable across reloads rather than shuffling on every fetch.
    .sort((a, b) => b.revenueTodayCents - a.revenueTodayCents || a.salonName.localeCompare(b.salonName))
    .slice(0, limit)
    .map((s, i) => ({ rank: i + 1, ...s }));
}

export function summarize(portfolio: OwnerPortfolio, totals: SalonTotals[]): PortfolioSummary {
  const byTenant = new Map(totals.map((t) => [t.tenantId, t]));

  let appointmentsToday = 0, checkedIn = 0, customersWaiting = 0;
  let servicesInProgress = 0, readyForCheckout = 0, techniciansWorking = 0, newClientsToday = 0;
  let revenueTodayCents = 0, revenueMonthCents = 0, tipsTodayCents = 0;
  let revenueYesterdayCents = 0, tipsYesterdayCents = 0, appointmentsYesterday = 0, checkedInYesterday = 0, newClientsYesterday = 0;
  let withheld = 0, activeSalons = 0, totalBranches = 0;
  let aiConfigured = 0, aiLive = 0;

  for (const salon of portfolio.salons) {
    if (isSalonSelectable(salon)) activeSalons++;
    totalBranches += salon.branches.length;

    const t = byTenant.get(salon.tenantId);
    if (!t) { withheld++; continue; }

    if (canAtSalon(salon.accessLevel, 'view')) {
      appointmentsToday += t.appointmentsToday;
      checkedIn += t.checkedIn;
      customersWaiting += t.customersWaiting;
      servicesInProgress += t.servicesInProgress;
      readyForCheckout += t.readyForCheckout;
      techniciansWorking += t.techniciansWorking;
      newClientsToday += t.newClientsToday;

      // The baselines, aggregated over EXACTLY the same salon set as the current figures. Comparing a total
      // built from four salons against one built from three would manufacture a change that never happened.
      revenueYesterdayCents += t.revenueYesterdayCents;
      tipsYesterdayCents += t.tipsYesterdayCents;
      appointmentsYesterday += t.appointmentsYesterday;
      checkedInYesterday += t.checkedInYesterday;
      newClientsYesterday += t.newClientsYesterday;

      if (t.aiReceptionistLive !== null) {
        aiConfigured++;
        if (t.aiReceptionistLive) aiLive++;
      }
    }

    if (canAtSalon(salon.accessLevel, 'reports')) {
      revenueTodayCents += t.revenueTodayCents;
      revenueMonthCents += t.revenueMonthCents;
      tipsTodayCents += t.tipsTodayCents;
    } else {
      withheld++;
    }
  }

  return {
    totalSalons: portfolio.salons.length,
    activeSalons,
    totalBranches,
    appointmentsToday,
    checkedIn,
    customersWaiting,
    servicesInProgress,
    readyForCheckout,
    techniciansWorking,
    newClientsToday,
    revenueTodayCents,
    revenueMonthCents,
    tipsTodayCents,
    // Honest, not decorative: "none" when nobody has configured one, "degraded" when some are down.
    aiReceptionist: aiConfigured === 0 ? 'none' : aiLive === aiConfigured ? 'live' : 'degraded',
    salonsWithheldForPermission: withheld,
    // Change vs YESTERDAY, computed — never typed in. A `null` means the comparison is undefined (no baseline),
    // and the card renders NOTHING rather than a percentage that would look precise and mean nothing.
    changes: {
      revenueTodayPct: pctChange(revenueTodayCents, revenueYesterdayCents),
      tipsTodayPct: pctChange(tipsTodayCents, tipsYesterdayCents),
      appointmentsPct: pctChange(appointmentsToday, appointmentsYesterday),
      checkedInPct: pctChange(checkedIn, checkedInYesterday),
      newClientsPct: pctChange(newClientsToday, newClientsYesterday),
    },
  };
}
