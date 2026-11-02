// technician-commission-rules.ts — the POS technician commission edit, written as rules of the ONE compensation engine
// (wave 4 PILOT, Oct 13 2026).
//
// PATCH /pos/technicians/:id/commission used to store `defaultPercent` in technicians.default_commission_split_percent —
// a column nothing in the money path reads — and drop `byService` / `byCategory` entirely, while answering 200 and
// spending the Super Admin's one-time code. Payroll's precedence is authored rule → service rate → tenant default
// (compensation-rule-loader.pickLineCommission), so the edit now becomes authored rules at the technician levels of the
// resolver's ladder:
//   defaultPercent        → "Technician Default"     (scope: technician)
//   byService[i].percent  → "Technician + Service"   (scope: technician + service)
//   byCategory[i].percent → "Technician + Category"  (scope: technician + category)
// Each is activated from NOW through the rules repository's own activate (which supersedes that rule's previous active
// version and keeps it as history). The caller has already verified the Super Admin authorization code once for the
// whole edit; the rule versions are activated under that same authorization (no second code is asked for).
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { KyselyCompensationRulesRepo, type PolicyRow, type PolicyScope, type RuleContext } from '../compensation/compensation-rules.repository';

export interface TechnicianCommissionEdit {
  defaultPercent?: number | null;
  byService?: { serviceId: string; percent: number }[] | null;
  byCategory?: { category: string; percent: number }[] | null;
}

const pct = (v: unknown, label: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new RangeError(`${label} must be 0–100`);
  return n;
};

/** Validate the whole edit before anything is written (all-or-nothing on bad input). */
export function validateTechnicianCommissionEdit(c: TechnicianCommissionEdit): void {
  if (c.defaultPercent != null) pct(c.defaultPercent, 'Commission percent');
  for (const s of c.byService ?? []) { if (!s?.serviceId) throw new RangeError('Each service rate needs a service'); pct(s.percent, 'Service commission percent'); }
  for (const s of c.byCategory ?? []) { if (!s?.category) throw new RangeError('Each category rate needs a category'); pct(s.percent, 'Category commission percent'); }
}

const sameScope = (p: PolicyRow, sc: PolicyScope) =>
  (p.scope.branchId ?? null) === (sc.branchId ?? null) && (p.scope.technicianId ?? null) === (sc.technicianId ?? null)
  && (p.scope.serviceId ?? null) === (sc.serviceId ?? null) && (p.scope.serviceCategory ?? null) === (sc.serviceCategory ?? null)
  && (p.scope.ticketId ?? null) === (sc.ticketId ?? null);

/** Author + activate (from now) one percent rule at `scope`, superseding that scope's previous active version. */
async function upsertActive(repo: KyselyCompensationRulesRepo, ctx: RuleContext, policies: PolicyRow[], scope: PolicyScope, percent: number, label: string, nowIso: string) {
  const version = { commissionType: 'percent' as const, commissionValue: percent, effectiveStart: nowIso, effectiveEnd: null };
  const existing = policies.find((p) => sameScope(p, scope));
  const active = existing?.versions.find((v) => v.status === 'active');
  if (active && Number(active.commissionValue) === Math.round(percent) && active.commissionType === 'percent') return;   // unchanged
  const versionId = existing
    ? (await repo.addVersion(ctx, existing.id, version))?.id
    : (await repo.createPolicy(ctx, scope, label, version)).versions.find((v) => v.version === 1)?.id;
  if (!versionId) throw new Error('Could not author the commission rule.');
  await repo.activateVersion(ctx, versionId);
}

/** Write the edit as engine rules. Returns nothing; the read-back is `readTechnicianCommissionRules`. */
export async function authorTechnicianCommissionRules(db: Kysely<DB>, ctx: RuleContext, technicianId: string, c: TechnicianCommissionEdit, now: Date = new Date()): Promise<void> {
  const repo = new KyselyCompensationRulesRepo(db);
  const nowIso = now.toISOString();
  const policies = await repo.listPolicies({ tenantId: ctx.tenantId, userId: ctx.userId });
  if (c.defaultPercent != null) await upsertActive(repo, ctx, policies, { technicianId }, Number(c.defaultPercent), 'Technician default (POS)', nowIso);
  for (const s of c.byService ?? []) await upsertActive(repo, ctx, policies, { technicianId, serviceId: s.serviceId }, Number(s.percent), 'Technician + service (POS)', nowIso);
  for (const s of c.byCategory ?? []) await upsertActive(repo, ctx, policies, { technicianId, serviceCategory: s.category }, Number(s.percent), 'Technician + category (POS)', nowIso);
}

/** The technician's active rules, in the POS commission shape (null default = none authored). */
export async function readTechnicianCommissionRules(db: Kysely<DB>, tenantId: string, technicianId: string): Promise<{ defaultPercent: number | null; byService: { serviceId: string; percent: number }[]; byCategory: { category: string; percent: number }[] }> {
  const repo = new KyselyCompensationRulesRepo(db);
  const mine = (await repo.listPolicies({ tenantId })).filter((p) => p.scope.technicianId === technicianId && !p.scope.ticketId && !p.scope.branchId);
  const activePct = (p: PolicyRow) => { const v = p.versions.find((x) => x.status === 'active' && x.commissionType === 'percent'); return v ? Number(v.commissionValue) : null; };
  let defaultPercent: number | null = null; const byService: { serviceId: string; percent: number }[] = []; const byCategory: { category: string; percent: number }[] = [];
  for (const p of mine) {
    const v = activePct(p); if (v == null) continue;
    if (p.scope.serviceId) byService.push({ serviceId: p.scope.serviceId, percent: v });
    else if (p.scope.serviceCategory) byCategory.push({ category: p.scope.serviceCategory, percent: v });
    else defaultPercent = v;
  }
  return { defaultPercent, byService, byCategory };
}
