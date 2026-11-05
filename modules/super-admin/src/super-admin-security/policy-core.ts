// Pure logic for security policies (MFA / password / session). No DB/Nest deps. Validates each policy kind's config,
// evaluates it against a DOCUMENTED internal baseline to derive a Compliant/Review status (an internal control score, NOT
// a claim of external certification), and handles versioning. Policies store configuration only — never passwords,
// secrets, or reversible data.

export const POLICY_KINDS = ['mfa', 'password', 'session'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];
export type Config = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown) => v === true;
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

export function validatePasswordPolicy(c: Config): ValidateResult {
  const e: string[] = [];
  const min = num(c.minLength), max = num(c.maxLength, 128);
  if (min < 8 || min > 128) e.push('minLength must be 8–128');
  if (max < min) e.push('maxLength must be ≥ minLength');
  if (num(c.historyCount, 0) < 0) e.push('historyCount must be ≥ 0');
  if (num(c.lockoutThreshold, 1) < 1) e.push('lockoutThreshold must be ≥ 1');
  return e.length ? { ok: false, errors: e } : { ok: true };
}
export function validateSessionPolicy(c: Config): ValidateResult {
  const e: string[] = [];
  if (num(c.idleMinutes, 1) <= 0) e.push('idleMinutes must be > 0');
  if (num(c.absoluteHours, 1) <= 0) e.push('absoluteHours must be > 0');
  if (num(c.refreshDays, 1) <= 0) e.push('refreshDays must be > 0');
  if (num(c.privilegedIdleMinutes, 1) <= 0) e.push('privilegedIdleMinutes must be > 0');
  if (num(c.concurrentLimit, 1) < 1) e.push('concurrentLimit must be ≥ 1');
  return e.length ? { ok: false, errors: e } : { ok: true };
}
export function validateMfaPolicy(c: Config): ValidateResult {
  const e: string[] = [];
  if (arr(c.requiredRoles).length === 0) e.push('at least one required role');
  if (arr(c.methods).length === 0) e.push('at least one approved method');
  if (num(c.graceDays, 0) < 0) e.push('graceDays must be ≥ 0');
  return e.length ? { ok: false, errors: e } : { ok: true };
}
export function validatePolicy(kind: string, c: Config): ValidateResult {
  const k = String(kind || '').toLowerCase();
  if (k === 'password') return validatePasswordPolicy(c);
  if (k === 'session') return validateSessionPolicy(c);
  if (k === 'mfa') return validateMfaPolicy(c);
  return { ok: false, errors: [`unknown policy kind "${kind}"`] };
}

// Internal compliance baseline (documented; not external certification). Returns compliant + the failing checks.
export function evaluateCompliance(kind: string, c: Config): { compliant: boolean; failing: string[] } {
  const k = String(kind || '').toLowerCase(); const failing: string[] = [];
  if (k === 'password') {
    if (num(c.minLength) < 12) failing.push('minLength ≥ 12');
    if (!bool(c.compromisedCheck)) failing.push('compromised-password detection on');
    if (!bool(c.commonRejection)) failing.push('common-password rejection on');
    if (num(c.lockoutThreshold, 99) > 10) failing.push('lockoutThreshold ≤ 10');
  } else if (k === 'session') {
    if (num(c.idleMinutes, 999) > 30) failing.push('idleMinutes ≤ 30');
    if (num(c.absoluteHours, 999) > 24) failing.push('absoluteHours ≤ 24');
    if (num(c.privilegedIdleMinutes, 999) > 15) failing.push('privilegedIdleMinutes ≤ 15');
    if (!bool(c.reauthForSensitive)) failing.push('step-up for sensitive actions on');
  } else if (k === 'mfa') {
    const roles = arr(c.requiredRoles).map((r) => r.toUpperCase());
    if (!roles.includes('SUPER_ADMIN')) failing.push('SUPER_ADMIN required');
    if (!roles.includes('OWNER')) failing.push('OWNER required');
    if (arr(c.methods).length === 0) failing.push('≥ 1 approved method');
  } else return { compliant: false, failing: ['unknown kind'] };
  return { compliant: failing.length === 0, failing };
}

export function nextPolicyVersion(existing: number[]): number { return (existing && existing.length ? Math.max(...existing) : 0) + 1; }
export function policyStatusLabel(compliant: boolean): 'Compliant' | 'Review' { return compliant ? 'Compliant' : 'Review'; }
