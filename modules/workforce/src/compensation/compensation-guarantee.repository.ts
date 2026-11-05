/**
 * compensation-guarantee.repository.ts — store/read guarantee policies (§6–§8) and resolve the most-specific ACTIVE
 * policy for a technician AS-OF a date (technician-specific > branch default > tenant default), so historical periods
 * keep the policy that applied then (§5). Pure mapper `rowToPolicy` is unit-tested without a DB.
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { GuaranteePolicy } from './compensation-guarantee';

export interface GuaranteePolicyRow {
  technician_id: string | null; branch_id: string | null;
  period: string; guaranteed_cents: number; proration: string; type: string;
  include_service_commission: boolean; include_hourly: boolean; include_salary: boolean;
  include_retail: boolean; include_bonus: boolean; include_manual: boolean;
  require_clocked_in: boolean; min_hours_required: number | null; probation_excluded: boolean;
  effective_start: any; effective_end: any; version: number;
}

/** PURE: DB row → engine GuaranteePolicy. */
export function rowToPolicy(r: GuaranteePolicyRow): GuaranteePolicy {
  return {
    period: r.period as any, guaranteedCents: Number(r.guaranteed_cents || 0), proration: r.proration as any, type: r.type as any,
    include: { serviceCommission: r.include_service_commission, hourly: r.include_hourly, salary: r.include_salary, retailCommission: r.include_retail, bonus: r.include_bonus, manualAdjustments: r.include_manual },
    requireClockedIn: r.require_clocked_in, minHoursRequired: r.min_hours_required ?? undefined, probationExcluded: r.probation_excluded,
    effectiveStart: new Date(r.effective_start).toISOString(), effectiveEnd: r.effective_end ? new Date(r.effective_end).toISOString() : undefined,
  };
}

/** PURE: pick the most specific active row for a technician as-of a date. */
export function resolveGuaranteeRow(rows: GuaranteePolicyRow[], technicianId: string, branchId: string | null, asOfIso: string): GuaranteePolicyRow | null {
  const asOf = new Date(asOfIso).getTime();
  const active = rows.filter((r) => {
    if (new Date(r.effective_start).getTime() > asOf) return false;
    if (r.effective_end && new Date(r.effective_end).getTime() < asOf) return false;
    if (r.technician_id && r.technician_id !== technicianId) return false;
    if (r.branch_id && r.branch_id !== branchId) return false;
    return true;
  });
  const score = (r: GuaranteePolicyRow) => (r.technician_id ? 2 : 0) + (r.branch_id ? 1 : 0); // tech > branch > tenant
  return active.sort((a, b) => (score(b) - score(a)) || (new Date(b.effective_start).getTime() - new Date(a.effective_start).getTime()) || (b.version - a.version))[0] ?? null;
}

export class GuaranteePolicyRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async listActive(tenantId: string): Promise<GuaranteePolicyRow[]> {
    return (this.db as any).selectFrom('technician_guarantee_policies').selectAll()
      .where('tenant_id', '=', tenantId).where('status', '=', 'active').execute().catch(() => []);
  }

  async resolveForTechnician(tenantId: string, technicianId: string, branchId: string | null, asOfIso: string): Promise<GuaranteePolicy | null> {
    const row = resolveGuaranteeRow(await this.listActive(tenantId), technicianId, branchId, asOfIso);
    return row ? rowToPolicy(row) : null;
  }
}
