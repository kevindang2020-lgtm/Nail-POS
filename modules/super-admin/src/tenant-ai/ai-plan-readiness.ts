// ai-plan-readiness.ts — AI Plans #05 "Subscription vs Readiness Split" (extras round 9). A plan card used to show ONE state
// (trialing / active / past due / cancelled …) — the COMMERCIAL state: may this salon use it. Whether it can actually WORK
// right now is a separate, TECHNICAL question, answered here from real records only:
//   provider_down    the AI gateway has no provider key to call (the env names it reads), or every provider Super Admin
//                    configured is marked 'error' (ai_providers), or Super Admin turned the assistant off platform-wide
//                    (platform_ai_package_settings)
//   setup_required   the salon still has to set something up: AI Phone Call Assistant needs a receptionist agent that is
//                    ready or live (ai_receptionist_agents)
//   ready            neither of the above
// The commercial state is never derived from this, and this never changes a subscription. Read-only.
import { sql, type Kysely } from 'kysely';
import { aiProviderKeysPresent } from '../super-admin-ai-usage/ai-usage-config-core';

export type TechReadiness = 'ready' | 'setup_required' | 'provider_down';
export type ReadinessReason = 'no_provider_connected' | 'provider_error' | 'turned_off_by_platform' | 'receptionist_not_set_up';
export interface ReadinessFacts { providerKeys: number; providerRows: { status: string }[]; platformOff: Set<string>; receptionistReady: boolean }
export interface PackageReadiness { code: string; state: TechReadiness; reason: ReadinessReason | null }
export interface PlanReadiness { state: TechReadiness; provider: { state: 'connected' | 'not_connected' | 'error'; reason: ReadinessReason | null }; packages: PackageReadiness[]; checkedAt: string }

/** Packages that cannot run until the salon sets something up, and what. */
const SETUP_NEEDS: Record<string, (f: ReadinessFacts) => ReadinessReason | null> = {
  ai_phone_call_assistant: (f) => (f.receptionistReady ? null : 'receptionist_not_set_up'),
};
const RANK: Record<TechReadiness, number> = { ready: 0, setup_required: 1, provider_down: 2 };

/** Pure: a plan's technical readiness from its member package codes and the facts. */
export function planReadiness(packageCodes: readonly string[], f: ReadinessFacts, now = new Date()): PlanReadiness {
  const allError = f.providerRows.length > 0 && f.providerRows.every((r) => r.status === 'error' || r.status === 'disabled') && f.providerRows.some((r) => r.status === 'error');
  const provider = f.providerKeys === 0 ? { state: 'not_connected' as const, reason: 'no_provider_connected' as const }
    : allError ? { state: 'error' as const, reason: 'provider_error' as const } : { state: 'connected' as const, reason: null };
  const packages = packageCodes.map((code): PackageReadiness => {
    if (provider.reason) return { code, state: 'provider_down', reason: provider.reason };
    if (f.platformOff.has(code)) return { code, state: 'provider_down', reason: 'turned_off_by_platform' };
    const need = SETUP_NEEDS[code]?.(f) ?? null;
    return need ? { code, state: 'setup_required', reason: need } : { code, state: 'ready', reason: null };
  });
  const state = packages.reduce<TechReadiness>((w, p) => (RANK[p.state] > RANK[w] ? p.state : w), 'ready');
  return { state, provider, packages, checkedAt: now.toISOString() };
}

/** The facts for one salon (null database → nothing is known to be ready: provider_down with no provider rows). */
export async function readinessFacts(db: Kysely<any> | null, tenantId: string, env: Record<string, string | undefined> = process.env): Promise<ReadinessFacts> {
  const providerKeys = aiProviderKeysPresent(env);
  if (!db) return { providerKeys, providerRows: [], platformOff: new Set(), receptionistReady: false };
  const [rows, off, rec] = await Promise.all([
    sql<{ status: string }>`select p.status from ai_providers p`.execute(db).then((r) => r.rows),
    sql<{ package_code: string }>`select s.package_code from platform_ai_package_settings s where not s.enabled`.execute(db).then((r) => r.rows),
    sql<{ n: number }>`select count(*)::int as n from ai_receptionist_agents a where a.tenant_id = ${tenantId} and a.status in ('ready', 'live')`.execute(db).then((r) => r.rows[0]),
  ]);
  return { providerKeys, providerRows: rows.map((r) => ({ status: String(r.status) })), platformOff: new Set(off.map((r) => String(r.package_code))), receptionistReady: Number(rec?.n ?? 0) > 0 };
}
