// Directory enrichment mappers — AIPowerSalon Super Admin (spec §17 onboarding pipeline, §21 renewals).
// Phase 2b. PURE + DETERMINISTIC: the Kysely repo does only thin SELECTs against confirmed columns and
// hands the raw rows here; all shaping/derivation lives in this tested layer.

/** Raw rows the repository supplies. `null` for a source means "not connected" (honest), not empty data. */
export interface DirectoryEnrichmentRaw {
  /** Count of POS terminals currently active (pos_payment_terminals.status). */
  activePosDevices: number | null;
  /** tenant_applications.status for every live application (rejected/archived included; mapper handles them). */
  applications: Array<{ status: string }> | null;
  /** tenant_subscriptions joined to tenant name/plan for renewal projection. */
  renewals: Array<{ tenantId: string; tenantName: string | null; plan: string | null; currentPeriodEnd: string | null }> | null;
}

export interface PipelineStage { key: string; label: string; count: number }
export interface OnboardingPipeline { stages: PipelineStage[]; conversionRatePct: number; available: boolean }

export interface RenewalRow {
  tenantId: string; tenantName: string | null; plan: string | null;
  renewalDate: string; daysRemaining: number; warning: 'past_due' | 'renewal_approaching' | 'ok';
}
export interface UpcomingRenewals { rows: RenewalRow[]; available: boolean }

// Funnel stage ranks (a tenant application has one status; we count how far it has REACHED, so the funnel is
// monotonic and no application is double-placed — §17). Unknown statuses count as "received" only.
const STATUS_RANK: Array<{ test: RegExp; rank: number }> = [
  { test: /converted/i, rank: 5 },
  { test: /approved/i, rank: 4 },
  { test: /qualified/i, rank: 3 },
  { test: /review|reviewing|demo/i, rank: 2 },
  { test: /waiting|document/i, rank: 1 },
];
function rankOf(status: string): number {
  const s = (status || '').toLowerCase();
  if (/reject|not[_\s-]?qualified|archiv/.test(s)) return 0; // left the funnel — counted as received only
  for (const r of STATUS_RANK) if (r.test.test(s)) return r.rank;
  return 0; // new / unknown
}

const PIPELINE_STAGES: Array<{ key: string; label: string; minRank: number }> = [
  { key: 'received', label: 'Applications Received', minRank: 0 },
  { key: 'documents', label: 'Documents Submitted', minRank: 1 },
  { key: 'under_review', label: 'Under Review', minRank: 2 },
  { key: 'pending_approval', label: 'Pending Approval', minRank: 3 },
  { key: 'approved', label: 'Approved', minRank: 4 },
  { key: 'setup_in_progress', label: 'Set Up In Progress', minRank: 5 },
];

export function buildOnboardingPipeline(raw: DirectoryEnrichmentRaw['applications']): OnboardingPipeline {
  if (raw == null) return { stages: [], conversionRatePct: 0, available: false };
  const ranks = raw.map((a) => rankOf(a.status));
  const total = ranks.length;
  const stages = PIPELINE_STAGES.map((s) => ({
    key: s.key, label: s.label, count: ranks.filter((r) => r >= s.minRank).length,
  }));
  // Conversion = applications that reached Approved-or-beyond ÷ total received. Calculated, never hardcoded (§17).
  const approved = ranks.filter((r) => r >= 4).length;
  const conversionRatePct = total > 0 ? Math.round((approved / total) * 1000) / 10 : 0;
  return { stages, conversionRatePct, available: true };
}

export function buildUpcomingRenewals(
  raw: DirectoryEnrichmentRaw['renewals'],
  opts: { now?: number; limit?: number } = {},
): UpcomingRenewals {
  if (raw == null) return { rows: [], available: false };
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 6;
  const rows: RenewalRow[] = raw
    .filter((r) => r.currentPeriodEnd)
    .map((r) => {
      const end = new Date(r.currentPeriodEnd as string).getTime();
      const daysRemaining = Math.ceil((end - now) / 86_400_000);
      const warning: RenewalRow['warning'] = daysRemaining < 0 ? 'past_due' : daysRemaining <= 7 ? 'renewal_approaching' : 'ok';
      return { tenantId: r.tenantId, tenantName: r.tenantName, plan: r.plan, renewalDate: new Date(end).toISOString(), daysRemaining, warning };
    })
    .filter((r) => Number.isFinite(r.daysRemaining))
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
    .slice(0, limit);
  return { rows, available: true };
}
