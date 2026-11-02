// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { TrendDir, WaitStatus } from '@aipowersalon/api-contracts/platform';
import type { TrendDir, WaitStatus } from '@aipowersalon/api-contracts/platform';
// booking-checkin-core.ts — pure, I/O-free math for the Super Admin Booking & Check-In Monitor Overview. Everything
// here is unit-tested. The service composes real DB rows; this module owns the formulas (§40) and the business-semantic
// trend coloring (§9), so percentages/rates/reconciliation have exactly one definition.

// Semantic (the good / warn / bad / neutral tone of a KPI): ONE definition, the platform contract's (Constitution 13 §15)
// — this module had its own copy (four modules did, one of them without 'warn').
export type { Semantic } from '@aipowersalon/api-contracts/platform';
import type { Semantic } from '@aipowersalon/api-contracts/platform';

/** Safe percentage (0 when denominator is 0). Rounded to one decimal. */
export function pct(n: number, d: number): number {
  if (!d || d <= 0) return 0;
  return Math.round((n / d) * 1000) / 10;
}

/** Period-over-period trend. deltaPct is signed and relative to the previous value. */
export function trend(curr: number, prev: number): { deltaPct: number; direction: TrendDir } {
  if (prev === 0) return { deltaPct: curr === 0 ? 0 : 100, direction: curr === 0 ? 'flat' : 'up' };
  const delta = Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
  return { deltaPct: delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}

/** Business-semantic color for a KPI's movement. For most counts up=good; for failure/duplicate/unmatched/API-failure
 *  KPIs up=bad; for average check-in time down=good (faster). 'flat' is always neutral. */
export function kpiSemantic(key: string, direction: TrendDir): Semantic {
  if (direction === 'flat') return 'neutral';
  const lowerIsBetter = new Set(['avg_check_in_time']);
  const upIsBad = new Set(['failed_check_ins', 'duplicate_check_ins', 'unmatched_customers', 'booking_api_failures', 'pending_confirmations']);
  if (lowerIsBetter.has(key)) return direction === 'down' ? 'good' : 'bad';
  if (upIsBad.has(key)) return direction === 'up' ? 'bad' : 'good';
  return direction === 'up' ? 'good' : 'bad';
}

/** Lifecycle stage conversion vs. the cohort base (the "Booked" count). */
export function stagePct(count: number, base: number): number { return pct(count, base); }

/** Wait-time bucket from average seconds against configurable ascending thresholds (seconds). */
export function waitStatus(avgSeconds: number, thresholds: { acceptable: number; atRisk: number; poor: number; critical: number }): WaitStatus {
  if (avgSeconds >= thresholds.critical) return 'critical';
  if (avgSeconds >= thresholds.poor) return 'poor';
  if (avgSeconds >= thresholds.atRisk) return 'at_risk';
  if (avgSeconds >= thresholds.acceptable) return 'acceptable';
  return 'good';
}

export const DEFAULT_WAIT_THRESHOLDS = { acceptable: 360, atRisk: 480, poor: 660, critical: 900 }; // 6/8/11/15 min

/** Mean of a list of durations in seconds (0 for empty). Caller is responsible for excluding abandoned/failed/invalid. */
export function avgSeconds(durations: number[]): number {
  const valid = durations.filter((d) => Number.isFinite(d) && d >= 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/** mm·ss formatter for a seconds value (e.g. 512 → "08m 32s"). */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Device uptime = healthy monitored time / expected monitored time (§40). Here approximated as healthy/total devices. */
export function uptimePct(healthy: number, total: number): number { return pct(healthy, total); }

/** A part list reconciles against a stated total when the parts sum to it exactly. */
export function reconciles(parts: number[], total: number): boolean {
  return parts.reduce((a, b) => a + b, 0) === total;
}

/** Distribute a list of {key,count} into percentage shares that always sum to the total count. */
export function shares<T extends { count: number }>(rows: T[]): (T & { pct: number })[] {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return rows.map((r) => ({ ...r, pct: pct(r.count, total) }));
}
