// super-admin-ai-scheduling-optimizer-core.ts — BUILD_PLAN Phase 7 (agent B): PURE platform-oversight rules for the AI
// Scheduling Optimizer. Super Admin sees operational COUNTS; one salon's detail requires an ACTIVE canonical support
// session (support_access_sessions: this admin, this salon, not ended, not expired) — the old ad-hoc "type a reason"
// gate (no session row, no expiry stored, role hard-coded) is gone. Every write needs step-up (controller) and a reason.
import type { SaSchedOverview } from '@aipowersalon/api-contracts/platform';

export const MIN_ACTION_REASON = 12;

/** A reason a human will read in the audit trail: trimmed, ≥ MIN_ACTION_REASON characters, capped. null = refuse. */
export function actionReason(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  return s.length >= MIN_ACTION_REASON ? s.slice(0, 500) : null;
}

export interface SupportSessionRow { id: string; tenant_id: string; admin_user_id: string; ended_at: unknown; expires_at: unknown }
/** The canonical support session that authorizes a salon drill-down: this admin, this salon, open and unexpired. */
export function activeSupportSession(rows: SupportSessionRow[], adminUserId: string | null, tenantId: string, nowMs: number): SupportSessionRow | null {
  if (!adminUserId) return null;
  return rows.find((r) => String(r.tenant_id) === tenantId && String(r.admin_user_id) === adminUserId && r.ended_at == null && r.expires_at != null && new Date(r.expires_at as any).getTime() > nowMs) ?? null;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
/** Assemble the overview from grouped counts. Applied is split by the recommendation's own `automated` flag — the old
 *  overview counted every manual application as an "automatic action". */
export function buildOverview(input: {
  enabledTenants: number; killedTenants: number; platformKilled: boolean;
  runs: { status: string; n: number }[]; runsLast24h: number;
  recommendations: { status: string; automated: boolean; n: number }[];
  proposals: { status: string; n: number }[];
  conflictsOpen: number; understaffingOpen: number;
  explanations: { source: string | null; n: number }[]; llmCostMicroUsd30d: number;
  now?: Date;
}): SaSchedOverview {
  const recs: Record<string, number> = {};
  let manual = 0, automated = 0, failed = 0;
  for (const r of input.recommendations) {
    recs[r.status] = (recs[r.status] || 0) + num(r.n);
    if (r.status === 'applied') { if (r.automated) automated += num(r.n); else manual += num(r.n); }
    if (r.status === 'application_failed') failed += num(r.n);
  }
  const proposals: Record<string, number> = {};
  for (const p of input.proposals) proposals[p.status] = (proposals[p.status] || 0) + num(p.n);
  const runBy = (s: string) => input.runs.filter((r) => r.status === s).reduce((a, r) => a + num(r.n), 0);
  return {
    enabledTenants: num(input.enabledTenants), killedTenants: num(input.killedTenants), platformKilled: !!input.platformKilled,
    runs: { total: input.runs.reduce((a, r) => a + num(r.n), 0), completed: runBy('completed'), failed: runBy('failed'), last24h: num(input.runsLast24h) },
    recommendations: recs, applied: { manual, automated, failed }, proposals,
    conflictsOpen: num(input.conflictsOpen), understaffingOpen: num(input.understaffingOpen),
    explanations: { llm: input.explanations.filter((e) => e.source === 'llm').reduce((a, e) => a + num(e.n), 0), template: input.explanations.filter((e) => e.source === 'template').reduce((a, e) => a + num(e.n), 0) },
    llmCostMicroUsd30d: num(input.llmCostMicroUsd30d), generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
