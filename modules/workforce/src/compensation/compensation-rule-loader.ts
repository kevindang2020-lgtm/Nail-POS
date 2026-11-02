/**
 * compensation-rule-loader.ts — bridges the compensation RULE STORE (compensation_policies + _versions, migration 409)
 * to the pure 7-level resolver (compensation-policy.ts). This is the piece that was missing: the resolver was built and
 * tested but had no rules to read. `resolveLineCommission` loads a tenant's authored, effective-dated rules and returns
 * the winning commission for one (branch, technician, service, category) as of a given date — or NULL when no rule
 * matches, so the caller keeps its existing service-default behaviour (zero regression). Money is integer cents.
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { SERVICE_ROW_RANK, resolvePolicy, type CompensationRule, type ResolveContext } from './compensation-policy';
import { PLATFORM_FALLBACK_COMMISSION_PERCENT } from './commission-basis';

/** A version row joined to its policy scope — the raw shape the DB returns. */
export interface PolicyVersionRow {
  policy_id: string;
  version_id: string;
  version: number;
  branch_id: string | null;
  technician_id: string | null;
  service_id: string | null;
  service_category: string | null;
  ticket_id: string | null;
  commission_type: string;
  commission_value: number;
  supply_method: string;
  supply_value: number;
  discount_funding: string;
  effective_start: string | Date;
  effective_end: string | Date | null;
  approved: boolean;
}

/** The resolved commission for a line, with provenance (§4 "which rule was used"). */
export interface ResolvedLineCommission {
  commissionType: 'percent' | 'fixed';
  commissionValue: number;
  supplyMethod: string;
  supplyValue: number;
  discountFunding: string;
  policyId: string;
  policyVersion: number;
  source: string;
  /** the winning level's rank (compensation-policy LEVELS); lets the service row's own rate outrank Category / defaults */
  specificity: number;
}

const iso = (v: string | Date | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Pure: map a joined version row to the CompensationRule shape the resolver consumes. */
export function mapVersionRowToRule(tenantId: string, r: PolicyVersionRow): CompensationRule {
  return {
    id: r.version_id,
    tenantId,
    policyId: r.policy_id,
    version: Number(r.version),
    branchId: r.branch_id,
    technicianId: r.technician_id,
    serviceId: r.service_id,
    serviceCategory: r.service_category,
    ticketId: r.ticket_id,
    commission: { type: r.commission_type === 'fixed' ? 'fixed' : 'percent', value: Number(r.commission_value) },
    supply: { method: (r.supply_method as any) ?? 'none', value: Number(r.supply_value) },
    effectiveStart: iso(r.effective_start)!,
    effectiveEnd: iso(r.effective_end),
    approved: !!r.approved,
  };
}

/** Pure: run the resolver over already-loaded rules and shape the winner (or null). Kept separate for unit testing. */
export function resolveFromRules(rules: CompensationRule[], ctx: ResolveContext): ResolvedLineCommission | null {
  const won = resolvePolicy(rules, ctx);
  if (!won || !won.commission) return null;
  return {
    commissionType: won.commission.type === 'fixed' ? 'fixed' : 'percent',
    commissionValue: won.commission.value,
    supplyMethod: (won.supply?.method as string) ?? 'none',
    supplyValue: won.supply?.value ?? 0,
    discountFunding: 'proportional', // §13 wired in a later phase; default preserves today's behaviour
    policyId: won.policyId,
    policyVersion: won.version,
    source: won.source,
    specificity: won.specificity,
  };
}

/** Load a tenant's authored rules that are (or were) live — draft/pending/canceled never take effect. Date/scope/
 *  specificity filtering is the resolver's job (as-of the service-completion date), so historical tickets never move. */
export async function loadEffectiveRules(db: Kysely<DB>, tenantId: string): Promise<CompensationRule[]> {
  // Must NEVER throw — this runs in the money path (line creation). Any failure (missing table, limited db handle,
  // query error) degrades to "no authored rules", so the caller falls back to the service default rather than breaking
  // ticket creation. The whole builder+execute is guarded because a builder call can throw synchronously.
  try {
    const rows = await db
      .selectFrom('compensation_policy_versions as v')
      .innerJoin('compensation_policies as p', 'p.id', 'v.policy_id')
      .select([
        'v.policy_id as policy_id', 'v.id as version_id', 'v.version as version',
        'p.branch_id as branch_id', 'p.technician_id as technician_id', 'p.service_id as service_id',
        'p.service_category as service_category', 'p.ticket_id as ticket_id',
        'v.commission_type as commission_type', 'v.commission_value as commission_value',
        'v.supply_method as supply_method', 'v.supply_value as supply_value', 'v.discount_funding as discount_funding',
        'v.effective_start as effective_start', 'v.effective_end as effective_end', 'v.approved as approved',
      ])
      .where('v.tenant_id', '=', tenantId)
      .where('v.status', 'in', ['active', 'scheduled', 'expired', 'replaced'])
      .execute();
    return (rows as unknown as PolicyVersionRow[]).map((r) => mapVersionRowToRule(tenantId, r));
  } catch {
    return [];
  }
}

/**
 * Resolve the winning commission for a line as of `asOf` (default: now). Returns null when the tenant has authored no
 * matching rule — the caller then falls back to its existing service-level default, so behaviour is unchanged until a
 * salon opts in. Never throws: a query failure resolves to the fallback path.
 */
export async function resolveLineCommission(
  db: Kysely<DB>,
  ctx: { tenantId: string; branchId?: string | null; technicianId?: string | null; serviceId?: string | null; serviceCategory?: string | null; ticketId?: string | null; asOf?: string },
): Promise<ResolvedLineCommission | null> {
  const rules = await loadEffectiveRules(db, ctx.tenantId);
  if (!rules.length) return null;
  return resolveFromRules(rules, {
    tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, technicianId: ctx.technicianId ?? null,
    serviceId: ctx.serviceId ?? null, serviceCategory: ctx.serviceCategory ?? null, ticketId: ctx.ticketId ?? null,
    asOf: ctx.asOf,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Tenant default + the ONE "stamp a line" routine (merge Oct 12 2026 — Payroll mandate §11 deterministic precedence:
// authored rule (7-level resolver) → the service's own rate → tenant default). Ported from the other chat's Technician
// Profile phase 2.
// ---------------------------------------------------------------------------------------------------------------------

/** Provenance labels for lines priced without an authored rule. */
export const RULE_SOURCE_SERVICE_DEFAULT = 'Service default';
export const RULE_SOURCE_TENANT_DEFAULT = 'Tenant default rate';

/** tenants.default_commission_percent — the salon-wide rate when no authored rule and no service rate match. Falls back
 *  to the platform default (50) ONLY when the tenant never set one; never null, so a line can never silently price at
 *  $0 because "no rule matched". Never throws (money path). */
export async function defaultCommissionForTenant(db: Kysely<DB>, tenantId: string): Promise<{ commissionType: 'percent'; commissionValue: number; source: string }> {
  try {
    const row: any = await db.selectFrom('tenants').select(['default_commission_percent']).where('id', '=', tenantId).executeTakeFirst();
    const v = row?.default_commission_percent;
    const pct = v != null && Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : PLATFORM_FALLBACK_COMMISSION_PERCENT;
    return { commissionType: 'percent', commissionValue: pct, source: RULE_SOURCE_TENANT_DEFAULT };
  } catch {
    return { commissionType: 'percent', commissionValue: PLATFORM_FALLBACK_COMMISSION_PERCENT, source: RULE_SOURCE_TENANT_DEFAULT };
  }
}

export interface PickedLineCommission {
  commissionType: 'percent' | 'fixed'; commissionValue: number; supplyMethod: string; supplyValue: number;
  policyId: string | null; policyVersion: number | null; source: string;
}

/** PURE precedence (mandate §121): authored rule by level → the service's own rate at SERVICE_ROW_RANK → tenant default.
 *  An authored rule LESS specific than the service level (Category, Branch Default, Salon Default) does not beat the
 *  service row's explicit rate; Ticket / Technician / Branch+Service / Branch+Category / Service rules do. Always returns a rate. */
export function pickLineCommission(
  resolved: ResolvedLineCommission | null,
  serviceRate: { commission_type?: string | null; commission_value?: number | string | null } | null | undefined,
  tenantDefault: { commissionType: 'percent'; commissionValue: number; source: string },
): PickedLineCommission {
  // services.commission_type defaults to 'none' (no service-level rate) — only an explicit percent/fixed/flat rate counts
  const svcType = String(serviceRate?.commission_type ?? 'none');
  const hasServiceRate = !!serviceRate && svcType !== 'none' && serviceRate.commission_value != null && Number.isFinite(Number(serviceRate.commission_value));
  if (resolved && (!hasServiceRate || (resolved.specificity ?? 99) < SERVICE_ROW_RANK)) return { commissionType: resolved.commissionType, commissionValue: resolved.commissionValue, supplyMethod: resolved.supplyMethod, supplyValue: resolved.supplyValue, policyId: resolved.policyId, policyVersion: resolved.policyVersion, source: resolved.source };
  if (hasServiceRate) {
    return { commissionType: serviceRate.commission_type === 'fixed' || serviceRate.commission_type === 'flat' ? 'fixed' : 'percent', commissionValue: Math.round(Number(serviceRate.commission_value)), supplyMethod: 'none', supplyValue: 0, policyId: null, policyVersion: null, source: RULE_SOURCE_SERVICE_DEFAULT };
  }
  return { commissionType: 'percent', commissionValue: tenantDefault.commissionValue, supplyMethod: 'none', supplyValue: 0, policyId: null, policyVersion: null, source: tenantDefault.source };
}

/** Resolve with the full precedence (rule → service rate → tenant default). Never null, never throws. */
export async function resolveLineCommissionWithDefault(
  db: Kysely<DB>,
  ctx: { tenantId: string; branchId?: string | null; technicianId?: string | null; serviceId?: string | null; serviceCategory?: string | null; ticketId?: string | null; asOf?: string },
): Promise<PickedLineCommission> {
  const [resolved, tenantDefault] = await Promise.all([resolveLineCommission(db, ctx).catch(() => null), defaultCommissionForTenant(db, ctx.tenantId)]);
  let serviceRate: any = null;
  if (ctx.serviceId) {
    serviceRate = await db.selectFrom('services').select(['commission_type', 'commission_value'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ctx.serviceId).executeTakeFirst().catch(() => null);
  }
  return pickLineCommission(resolved, serviceRate, tenantDefault);
}

/**
 * Stamp the resolved commission (type/value/supply/policy_id/rule_source) onto ONE existing ticket_service_lines row,
 * using the line's own technician/service/category/branch. This is the single function the Service Done transition
 * calls so a line that reached completion without a snapshot (older writers inserted lines with NULL snapshots → $0)
 * is priced with the same precedence as serving/queue creation. `force=false` (default) only fills lines whose
 * commission_value_snapshot IS NULL — a line priced at creation is frozen (§5/§14). Returns the stamped rate or null
 * when the line does not exist (or is removed / retail). Safe inside a transaction (`trx`) or on the root handle.
 */
export async function stampCommissionOnLine(
  trx: Kysely<DB>, tenantId: string, lineId: string, opts: { force?: boolean; asOf?: string } = {},
): Promise<PickedLineCommission | null> {
  const line: any = await trx.selectFrom('ticket_service_lines')
    .select(['id', 'branch_id', 'ticket_id', 'service_id', 'technician_id', 'category_snapshot', 'commission_type_snapshot', 'commission_value_snapshot', 'supply_method_snapshot', 'supply_value_snapshot', 'policy_id', 'rule_source', 'removed_at', 'line_kind'])
    .where('tenant_id', '=', tenantId).where('id', '=', lineId).executeTakeFirst().catch(() => null);
  if (!line || line.removed_at != null) return null;
  if (!opts.force && line.commission_value_snapshot != null) {
    // already priced — report what is on the line without re-resolving (history never moves)
    return { commissionType: line.commission_type_snapshot === 'fixed' ? 'fixed' : 'percent', commissionValue: Number(line.commission_value_snapshot || 0), supplyMethod: line.supply_method_snapshot || 'none', supplyValue: Number(line.supply_value_snapshot || 0), policyId: line.policy_id ?? null, policyVersion: null, source: line.rule_source ?? RULE_SOURCE_SERVICE_DEFAULT };
  }
  if ((line.line_kind ?? '') === 'retail') return null; // retail commission is a salon policy, not a per-line rule (§16)
  const picked = await resolveLineCommissionWithDefault(trx, {
    tenantId, branchId: line.branch_id ?? null, technicianId: line.technician_id ?? null,
    serviceId: line.service_id && line.service_id !== '00000000-0000-0000-0000-000000000000' ? line.service_id : null,
    serviceCategory: line.category_snapshot ?? null, ticketId: line.ticket_id ?? null, asOf: opts.asOf,
  });
  await trx.updateTable('ticket_service_lines').set({
    commission_type_snapshot: picked.commissionType, commission_value_snapshot: picked.commissionValue,
    supply_method_snapshot: picked.supplyMethod, supply_value_snapshot: picked.supplyValue,
    policy_id: picked.policyId, rule_source: picked.source,
  }).where('tenant_id', '=', tenantId).where('id', '=', lineId).execute();
  return picked;
}
