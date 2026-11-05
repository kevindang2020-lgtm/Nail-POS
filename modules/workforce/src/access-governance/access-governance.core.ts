// access-governance.core.ts — BUILD_PLAN Phase 9 (Constitution 2 §153: access review, high-risk report, dormant accounts,
// denial metrics). Pure: no I/O. The service feeds it rows; tests feed it fixtures.
import { PERMISSIONS, decide, definitionOf, isHighRiskPermission, type AuthzOverride, type AuthzPrincipal, type PermissionSensitivity } from '@aipowersalon/permissions';
import type { AccessReviewDecision, AuthzReason, DormantAccountsReport, PermissionDenialMetrics } from '@aipowersalon/api-contracts/tenant';

/** The salon-side catalog keys (never super_admin.*). */
export const GOVERNED_KEYS: readonly string[] = (PERMISSIONS as readonly string[]).filter((k) => !k.startsWith('super_admin.'));
/** Keys the high-risk report and every access review list. */
export const HIGH_RISK_KEYS: readonly string[] = GOVERNED_KEYS.filter((k) => isHighRiskPermission(k));

export const DORMANT_DEFAULT_DAYS = 60;
export const DORMANT_MIN_DAYS = 7;
export const DORMANT_MAX_DAYS = 365;
const DAY_MS = 86_400_000;

/** What the report needs about one person's current authorization (from the authorization-state port). */
export interface MemberAuthz {
  userId: string; tenantId: string; role: string; status: string; templateKey: string | null;
  scope?: AuthzPrincipal['scope']; grant: readonly string[]; overrides: readonly AuthzOverride[];
}
export interface HighRiskGrant { key: string; sensitivity: PermissionSensitivity; via: AuthzReason }

/** The high-risk keys this person can use RIGHT NOW, and why (role / template / override / temporary). */
export function highRiskGrants(m: MemberAuthz, now: number | Date = Date.now()): HighRiskGrant[] {
  const p: AuthzPrincipal = { userId: m.userId, tenantId: m.tenantId, branchId: null, role: m.role, permissions: m.grant, status: m.status, templateKey: m.templateKey, scope: m.scope ?? null, branchIds: null, overrides: m.overrides };
  const out: HighRiskGrant[] = [];
  for (const key of HIGH_RISK_KEYS) {
    const d = decide(p, key, null, { now });
    if (d.allowed) out.push({ key, sensitivity: definitionOf(key)!.sensitivity, via: d.reason as AuthzReason });
  }
  return out;
}

/** Clamp ?days to a sane window (default 60). */
export function dormantThreshold(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || raw === undefined || raw === null || raw === '') return DORMANT_DEFAULT_DAYS;
  return Math.min(DORMANT_MAX_DAYS, Math.max(DORMANT_MIN_DAYS, n));
}

export interface DormantCandidate { userId: string; name: string; role: string; status: string; lastLoginAt: string | null; createdAt: string | null }
/** Active staff accounts with no sign-in for more than `days` (never signed in counts from the account's creation). */
export function dormantRows(users: readonly DormantCandidate[], days: number, now: number = Date.now()): DormantAccountsReport['rows'] {
  const cutoff = now - days * DAY_MS;
  const rows: DormantAccountsReport['rows'] = [];
  for (const u of users) {
    if (String(u.status).toLowerCase() !== 'active') continue;
    const last = u.lastLoginAt ? Date.parse(u.lastLoginAt) : null;
    const since = last ?? (u.createdAt ? Date.parse(u.createdAt) : null);
    if (since !== null && Number.isFinite(since) && since > cutoff) continue;
    rows.push({ userId: u.userId, name: u.name, role: u.role, lastLoginAt: u.lastLoginAt, daysSince: last !== null ? Math.floor((now - last) / DAY_MS) : null, status: u.status });
  }
  return rows.sort((a, b) => (b.daysSince ?? Number.MAX_SAFE_INTEGER) - (a.daysSince ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
}

/** One alert per dormancy EPISODE: keyed on the last sign-in the job saw, so a person who signs in and goes quiet again
 *  is alerted again, but a still-dormant account is never alerted twice. */
export function dormantEpisodeKey(lastLoginAt: string | null): string { return lastLoginAt ? new Date(lastLoginAt).toISOString() : 'never'; }

/** Validate an access-review decision before anything is written. */
export function validateReviewDecision(input: Partial<AccessReviewDecision> | null | undefined, actorUserId: string): { ok: true; value: AccessReviewDecision } | { ok: false; code: 'VALIDATION_FAILED' | 'PERMISSION_DENIED'; message: string } {
  const userId = String(input?.userId ?? '').trim();
  const decision = input?.decision;
  if (!userId) return { ok: false, code: 'VALIDATION_FAILED', message: 'Say whose access this decision is about (userId).' };
  if (decision !== 'keep' && decision !== 'revoke' && decision !== 'change') return { ok: false, code: 'VALIDATION_FAILED', message: 'decision must be keep, revoke or change.' };
  const templateKey = input?.templateKey ? String(input.templateKey).trim() : null;
  if (decision === 'change' && !templateKey) return { ok: false, code: 'VALIDATION_FAILED', message: 'A change needs the role (templateKey) the person moves to.' };
  if (decision !== 'keep' && userId === actorUserId) return { ok: false, code: 'PERMISSION_DENIED', message: 'You cannot revoke or change your own access in a review. Ask another owner.' };
  const note = input?.note == null ? null : String(input.note).trim().slice(0, 500) || null;
  if (decision === 'revoke' && !note) return { ok: false, code: 'VALIDATION_FAILED', message: 'Say why the access is revoked (note).' };
  return { ok: true, value: { userId, decision, note, templateKey: decision === 'change' ? templateKey : null } };
}

export interface DenialRow { permission: string; reason: string; userId: string | null; name: string | null; count: number }
/** Shape the denial window: totals by key, by reason, by person (highest first, top 25 each). */
export function denialMetrics(rows: readonly DenialRow[], from: string, to: string): PermissionDenialMetrics {
  const byKey = new Map<string, number>(); const byReason = new Map<string, number>(); const byUser = new Map<string, { name: string; count: number }>();
  let total = 0;
  for (const r of rows) {
    const n = Math.max(0, Number(r.count) || 0); total += n;
    byKey.set(r.permission, (byKey.get(r.permission) ?? 0) + n);
    byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + n);
    if (r.userId) { const u = byUser.get(r.userId) ?? { name: r.name ?? '—', count: 0 }; u.count += n; byUser.set(r.userId, u); }
  }
  const top = <T extends { count: number }>(xs: T[]) => xs.sort((a, b) => b.count - a.count).slice(0, 25);
  return {
    from, to, total,
    byKey: top([...byKey].map(([key, count]) => ({ key, count }))),
    byReason: top([...byReason].map(([reason, count]) => ({ reason: reason as AuthzReason, count }))),
    byUser: top([...byUser].map(([userId, v]) => ({ userId, name: v.name, count: v.count }))),
  };
}

/** The denial window: ISO dates or timestamps; default the last 7 days; at most 92 days. */
export function denialWindow(fromRaw: unknown, toRaw: unknown, now: number = Date.now()): { from: string; to: string } | null {
  const parse = (v: unknown): number | null => { if (v === undefined || v === null || v === '') return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? t : NaN; };
  const t = parse(toRaw); const f = parse(fromRaw);
  if (Number.isNaN(t as number) || Number.isNaN(f as number)) return null;
  // a date-only `to` ("2026-10-08") means the END of that day — otherwise "to today" silently dropped today's denials
  // (found by the Phase 9 live proof)
  const dateOnly = typeof toRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(toRaw.trim());
  const to = t == null ? now : dateOnly ? t + DAY_MS - 1 : t; const from = f ?? to - 7 * DAY_MS;
  if (from > to || to - from > 92 * DAY_MS) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
