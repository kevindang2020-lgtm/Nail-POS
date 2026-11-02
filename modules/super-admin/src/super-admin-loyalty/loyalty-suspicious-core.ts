// loyalty-suspicious-core.ts — pure, documented heuristics for suspicious-redemption detection. No DB. These are
// oversight SIGNALS over real redemption activity, not fraud determinations; severity is advisory. Thresholds are
// configurable by the caller. bucketKey gives an idempotent natural key so re-running detection updates, never duplicates.
export type SignalType = 'velocity' | 'high_value' | 'rapid_repeat';
export type Severity = 'low' | 'medium' | 'high';

export interface DetectionThresholds {
  velocityCount: number;      // ≥ this many redemptions by one member within a day-bucket
  velocityHigh: number;       // ≥ this ⇒ high severity
  highValuePoints: number;    // a single redemption ≥ this many points
  repeatCount: number;        // same member + same reward ≥ this many times within a day-bucket
}
export const DETECTION_DEFAULTS: DetectionThresholds = { velocityCount: 5, velocityHigh: 10, highValuePoints: 5000, repeatCount: 3 };

export function severityForVelocity(count: number, t: DetectionThresholds = DETECTION_DEFAULTS): Severity {
  if (count >= t.velocityHigh) return 'high';
  if (count >= t.velocityCount) return 'medium';
  return 'low';
}
export function severityForValue(points: number, t: DetectionThresholds = DETECTION_DEFAULTS): Severity {
  if (points >= t.highValuePoints * 2) return 'high';
  if (points >= t.highValuePoints) return 'medium';
  return 'low';
}
export function severityForRepeat(count: number, t: DetectionThresholds = DETECTION_DEFAULTS): Severity {
  return count >= t.repeatCount * 2 ? 'high' : count >= t.repeatCount ? 'medium' : 'low';
}

/** Natural idempotency key: one case per (tenant, customer, signal, day). Re-detection upserts the same bucket. */
export function bucketKey(tenantId: string, customerId: string | null, signal: SignalType, dayIso: string, extra = ''): string {
  return [tenantId, customerId ?? 'none', signal, dayIso.slice(0, 10), extra].filter(Boolean).join('|');
}

export const STATUS_FLOW: Record<string, string[]> = {
  open: ['reviewing', 'resolved', 'dismissed'],
  reviewing: ['resolved', 'dismissed', 'open'],
  resolved: [], dismissed: [],
};
export function canTransition(from: string, to: string): boolean {
  return (STATUS_FLOW[from] ?? []).includes(to);
}
