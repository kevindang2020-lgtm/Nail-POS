/**
 * compensation-policy.ts — the compensation POLICY HIERARCHY (spec §4–§5). Pure resolution: given the tenant's set of
 * effective-dated rules and a resolution context (tenant/branch/technician/service/category/date), return the single
 * winning rule — the MOST SPECIFIC active rule — with its provenance label, policy id and version. Resolution is always
 * done AS-OF the service completion date so historical tickets never change when a future rule is added (§5, §14).
 */
import type { CommissionType, Cents, SupplyMethod } from './compensation.types';

/** A scoped, effective-dated compensation rule. Any subset of scope fields may be set; the set fields must all match. */
export interface CompensationRule {
  id: string;
  tenantId: string;
  // scope (more set fields = more specific)
  ticketId?: string | null;
  technicianId?: string | null;
  serviceId?: string | null;
  serviceCategory?: string | null;
  branchId?: string | null;
  // payload
  commission?: { type: CommissionType; value: number };
  supply?: { method: SupplyMethod; value: number };
  // lifecycle
  effectiveStart: string;       // ISO date/time; rule inactive before this
  effectiveEnd?: string | null; // ISO; inactive after this (inclusive day)
  version: number;
  policyId: string;
  approved?: boolean;           // ticket overrides require approval (§24)
}

export interface ResolveContext {
  tenantId: string;
  branchId?: string | null;
  technicianId?: string | null;
  serviceId?: string | null;
  serviceCategory?: string | null;
  ticketId?: string | null;
  /** resolve AS-OF this instant (service completion date). Defaults to now. */
  asOf?: string;
}

export interface ResolvedPolicy {
  ruleId: string;
  policyId: string;
  version: number;
  source: string;               // human label of the winning level (§4)
  specificity: number;          // 1 (ticket) … 7 (tenant default); lower = more specific
  commission?: { type: CommissionType; value: number };
  supply?: { method: SupplyMethod; value: number };
}

/** Priority ladder (§4): lower number = more specific = wins. */
const LEVELS: { rank: number; label: string; match: (r: CompensationRule) => boolean }[] = [
  { rank: 1,  label: 'Ticket Override',        match: (r) => !!r.ticketId },
  { rank: 2,  label: 'Technician + Service',   match: (r) => !!r.technicianId && !!r.serviceId },
  { rank: 3,  label: 'Technician + Category',  match: (r) => !!r.technicianId && !!r.serviceCategory },
  { rank: 4,  label: 'Technician Default',     match: (r) => !!r.technicianId && !r.serviceId && !r.serviceCategory },
  { rank: 5,  label: 'Branch + Service',       match: (r) => !r.technicianId && !!r.branchId && !!r.serviceId },
  { rank: 6,  label: 'Branch + Category',      match: (r) => !r.technicianId && !!r.branchId && !r.serviceId && !!r.serviceCategory },
  { rank: 7,  label: 'Salon Service',          match: (r) => !r.ticketId && !r.technicianId && !r.branchId && !!r.serviceId },
  { rank: 8,  label: 'Salon Category',         match: (r) => !r.ticketId && !r.technicianId && !r.branchId && !r.serviceId && !!r.serviceCategory },
  { rank: 9,  label: 'Branch Default',         match: (r) => !r.technicianId && !!r.branchId && !r.serviceId && !r.serviceCategory },
  { rank: 10, label: 'Salon Default',          match: (r) => !r.ticketId && !r.technicianId && !r.serviceId && !r.serviceCategory && !r.branchId },
];

function levelOf(r: CompensationRule): { rank: number; label: string } {
  for (const l of LEVELS) if (l.match(r)) return { rank: l.rank, label: l.label };
  return { rank: 99, label: 'Unscoped' };
}

/** True when the rule's set scope fields all equal the context (an unset field matches anything). */
function scopeMatches(r: CompensationRule, ctx: ResolveContext): boolean {
  if (r.tenantId !== ctx.tenantId) return false;
  if (r.ticketId && r.ticketId !== ctx.ticketId) return false;
  if (r.technicianId && r.technicianId !== ctx.technicianId) return false;
  if (r.serviceId && r.serviceId !== ctx.serviceId) return false;
  if (r.serviceCategory && r.serviceCategory !== ctx.serviceCategory) return false;
  if (r.branchId && r.branchId !== ctx.branchId) return false;
  // a ticket-override rule must be approved to apply (§24)
  if (r.ticketId && r.approved === false) return false;
  return true;
}

function activeAt(r: CompensationRule, asOf: number): boolean {
  if (new Date(r.effectiveStart).getTime() > asOf) return false;
  if (r.effectiveEnd && new Date(r.effectiveEnd).getTime() < asOf) return false;
  return true;
}

/**
 * Resolve the winning rule for a context. Among scope-matching, date-active rules, the most specific (lowest rank)
 * wins; ties break to the latest effectiveStart, then highest version (the newest authored rule at that level).
 */
export function resolvePolicy(rules: CompensationRule[], ctx: ResolveContext): ResolvedPolicy | null {
  const asOf = new Date(ctx.asOf ?? new Date().toISOString()).getTime();
  const candidates = rules
    .filter((r) => scopeMatches(r, ctx) && activeAt(r, asOf))
    .map((r) => ({ r, lvl: levelOf(r) }))
    .sort((a, b) =>
      (a.lvl.rank - b.lvl.rank) ||
      (new Date(b.r.effectiveStart).getTime() - new Date(a.r.effectiveStart).getTime()) ||
      (b.r.version - a.r.version),
    );
  const winner = candidates[0];
  if (!winner) return null;
  return {
    ruleId: winner.r.id, policyId: winner.r.policyId, version: winner.r.version,
    source: winner.lvl.label, specificity: winner.lvl.rank,
    commission: winner.r.commission, supply: winner.r.supply,
  };
}

/** Owner-setting validation before publishing a policy (§27). Returns blocking errors + non-blocking warnings. */
export function validatePolicyRule(r: Partial<CompensationRule> & { technicianPercent?: number; salonPercent?: number; serviceEligibleCents?: Cents }): { errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  if (r.technicianPercent != null && r.salonPercent != null && r.technicianPercent + r.salonPercent !== 100) {
    errors.push(`Technician (${r.technicianPercent}%) + salon (${r.salonPercent}%) must total 100%.`);
  }
  if (r.commission?.type === 'percent' && (r.commission.value < 0 || r.commission.value > 100)) {
    errors.push(`Commission percent must be 0–100 (got ${r.commission.value}).`);
  }
  if (r.supply?.method === 'fixed' && r.serviceEligibleCents != null && r.supply.value > r.serviceEligibleCents) {
    errors.push(`Supply charge ${r.supply.value} exceeds eligible service amount ${r.serviceEligibleCents}.`);
  }
  if (r.effectiveStart && r.effectiveEnd && new Date(r.effectiveEnd).getTime() < new Date(r.effectiveStart).getTime()) {
    errors.push('Effective end date is before the start date.');
  }
  if (!r.commission && !r.supply) warnings.push('Rule sets neither a commission nor a supply payload.');
  return { errors, warnings };
}
