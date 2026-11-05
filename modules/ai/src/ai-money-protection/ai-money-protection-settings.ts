// ai-money-protection-settings.ts — pure logic for tenant rule settings. Validation is bounded so a tenant can
// tune but never break detection (e.g. can't set a retry threshold of 0). applyRuleSettings post-processes
// candidates for enable/disable + severity override — works for every rule uniformly. Threshold overrides are
// surfaced as a per-rule map the deterministic engine consults.
import type { AlertCandidate, Severity } from './ai-money-protection.dto';

export interface RuleSetting {
  ruleId: string;
  enabled: boolean;
  severityOverride: Severity | null;
  thresholds: Record<string, number>;
}
export type RuleSettingsMap = Record<string, RuleSetting>;

const SEVERITIES: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Per-key safe bounds. Unknown keys are rejected (prevents silently-ignored typos and abuse).
const BOUNDS: Record<string, [number, number]> = {
  windowSeconds: [10, 3600], minDeclines: [2, 50], windowMinutes: [1, 240], highSeverityAt: [2, 100],
  minReversals: [2, 20], toleranceCents: [0, 1_000_000], highSeverityMultiple: [2, 100],
  minSampleSize: [5, 5000], minPeers: [2, 500], zThreshold: [1, 10], minRatePct: [0, 100],
};

export interface ValidationResult { ok: boolean; errors: string[]; value?: RuleSetting; }

export function validateRuleSetting(ruleId: string, input: any, knownRuleIds: Set<string>): ValidationResult {
  const errors: string[] = [];
  if (!ruleId || !knownRuleIds.has(ruleId)) errors.push('Unknown rule id');
  const enabled = input?.enabled === undefined ? true : Boolean(input.enabled);
  let severityOverride: Severity | null = null;
  if (input?.severityOverride != null) {
    if (!SEVERITIES.includes(input.severityOverride)) errors.push('Invalid severityOverride');
    else severityOverride = input.severityOverride;
  }
  const thresholds: Record<string, number> = {};
  const t = input?.thresholds ?? {};
  for (const [k, v] of Object.entries(t)) {
    const bound = BOUNDS[k];
    if (!bound) { errors.push(`Unknown threshold "${k}"`); continue; }
    const num = Number(v);
    if (!Number.isFinite(num)) { errors.push(`Threshold "${k}" must be a number`); continue; }
    if (num < bound[0] || num > bound[1]) { errors.push(`Threshold "${k}" must be between ${bound[0]} and ${bound[1]}`); continue; }
    thresholds[k] = num;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { ruleId, enabled, severityOverride, thresholds } };
}

// Post-process candidates: drop disabled rules, apply severity overrides. Uniform across all rules.
export function applyRuleSettings(candidates: AlertCandidate[], map: RuleSettingsMap): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const c of candidates) {
    const s = map[c.ruleId];
    if (s && s.enabled === false) continue;
    if (s && s.severityOverride) out.push({ ...c, severity: s.severityOverride });
    else out.push(c);
  }
  return out;
}

// Extract the per-rule threshold overrides the deterministic engine consults.
export function thresholdOverrides(map: RuleSettingsMap): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [ruleId, s] of Object.entries(map)) if (s.thresholds && Object.keys(s.thresholds).length) out[ruleId] = s.thresholds;
  return out;
}
