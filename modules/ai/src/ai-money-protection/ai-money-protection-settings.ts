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

// ── Threshold Change Preview (Money Protection Rules 09) ─────────────────────────────────────────────────────────
// Dry run only: the deterministic detector is run twice over the same recent activity — once with the saved thresholds,
// once with the proposed ones — and the two candidate sets for ONE rule are compared by their stable fingerprint. Nothing
// is saved and no alert is created. Only rules whose detector actually reads a tenant threshold can be simulated; every
// other rule says so instead of showing a made-up number.
export const PREVIEW_SIMULATED_RULES: readonly string[] = ['MP_DUP_CHARGE_LIKELY', 'MP_FAILED_PAYMENT_RETRY_LOOP'];
export interface ThresholdPreviewChange { fingerprint: string; change: 'stops' | 'starts' | 'severity'; fromSeverity: Severity | null; toSeverity: Severity | null; ticketIds: string[]; amountCents: number }
export interface ThresholdPreviewDiff { currentCount: number; proposedCount: number; stops: number; starts: number; severityChanges: number; unchanged: number; examples: ThresholdPreviewChange[] }
export function previewThresholdDiff(ruleId: string, current: AlertCandidate[], proposed: AlertCandidate[], maxExamples = 10): ThresholdPreviewDiff {
  const mine = (xs: AlertCandidate[]) => new Map(xs.filter((c) => c.ruleId === ruleId).map((c) => [c.entityFingerprint, c]));
  const a = mine(current), b = mine(proposed);
  const changes: ThresholdPreviewChange[] = [];
  let unchanged = 0;
  const tickets = (c: AlertCandidate) => (c.related?.ticketIds ?? []).map(String);
  for (const [fp, c] of a) {
    const n = b.get(fp);
    if (!n) changes.push({ fingerprint: fp, change: 'stops', fromSeverity: c.severity, toSeverity: null, ticketIds: tickets(c), amountCents: c.amountCents });
    else if (n.severity !== c.severity) changes.push({ fingerprint: fp, change: 'severity', fromSeverity: c.severity, toSeverity: n.severity, ticketIds: tickets(c), amountCents: c.amountCents });
    else unchanged++;
  }
  for (const [fp, n] of b) if (!a.has(fp)) changes.push({ fingerprint: fp, change: 'starts', fromSeverity: null, toSeverity: n.severity, ticketIds: tickets(n), amountCents: n.amountCents });
  const order = { stops: 0, starts: 1, severity: 2 } as const;
  changes.sort((x, y) => order[x.change] - order[y.change] || x.fingerprint.localeCompare(y.fingerprint));
  return { currentCount: a.size, proposedCount: b.size, stops: changes.filter((c) => c.change === 'stops').length, starts: changes.filter((c) => c.change === 'starts').length,
    severityChanges: changes.filter((c) => c.change === 'severity').length, unchanged, examples: changes.slice(0, maxExamples) };
}
