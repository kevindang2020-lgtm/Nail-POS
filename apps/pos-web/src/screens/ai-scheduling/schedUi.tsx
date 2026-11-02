// schedUi.tsx — shared look + plain-language helpers for the AI Scheduling Optimizer workspace (BUILD_PLAN Phase 7).
// Reuses the Champagne Gold card / button styles of the AI Queue workspace so both AI tools read as one family.
import type React from 'react';
import type { SchedMetrics, SchedRecStatus, SchedRecType, SchedViolation } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { humanizeCode } from '../../i18n/status-label';
import { clockOfHHMM } from '../opsClock';
export { card, cardHead, input, btnGold, btnGhost, btnDanger, muted, errText, okText, pill, Stat, when, mins } from '../ai-queue/aiQueueUi';

/** The permission keys the server checks on every /pos/ai-scheduling-optimizer route (packages/permissions rbac.ts). */
export const P = {
  view: 'ai_scheduling.view', viewOwn: 'ai_scheduling.view_own', generate: 'ai_scheduling.generate', review: 'ai_scheduling.review',
  approve: 'ai_scheduling.approve', apply: 'ai_scheduling.apply', configure: 'ai_scheduling.configure', export: 'ai_scheduling.export',
} as const;
export type Can = (permission: string) => boolean;

export interface SchedCardProps {
  tick: number;
  can: Can;
  techName: (id: string | null | undefined) => string;
  onChanged: () => void;
}

export const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (ymd: string, n: number): string => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const newKey = (): string => globalThis.crypto?.randomUUID?.() || `sched-${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** a scheduling code (proposal / insight / run / time-off status, conflict type, staffing state, setting name) in the
 *  user's language (ops.sched.code / num / weight); an unknown code humanised — WP-C1 */
export const pretty = (s: string | null | undefined): string => {
  if (!s) return '';
  for (const ns of ['code', 'num', 'weight']) { const k = `ops.sched.${ns}.${s}`; const v = tx(k); if (v !== k) return v; }
  return humanizeCode(s);
};
/** 'HH:MM' (24h, branch zone) → the user's clock: '2:30 PM' / '14:30' (WP-C1) */
export const hm = (t: string | null | undefined): string => (t ? clockOfHHMM(t) : '—');
export const pctNum = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${Math.round(n)}%`);

/** code → label tables whose values are GETTERS (read in the current language at render — WP-B: never at import) */
function labelTable<K extends string>(prefix: string, codes: readonly K[]): Record<K, string> {
  const o = {} as Record<K, string>;
  for (const c of codes) Object.defineProperty(o, c, { enumerable: true, get: () => tx(`${prefix}.${c}`) });
  return o;
}
export const STATUS_LABEL: Record<SchedRecStatus, string> = labelTable<SchedRecStatus>('ops.sched.status', [
  'generated', 'review_required', 'review_in_progress', 'accepted', 'partially_accepted', 'rejected', 'needs_revision',
  'customer_approval_required', 'customer_approved', 'application_pending', 'applied', 'application_failed', 'expired',
  'superseded', 'rolled_back',
]);
export const TYPE_LABEL: Record<SchedRecType, string> = labelTable<SchedRecType>('ops.sched.type', [
  'move_appointment', 'change_technician', 'offer_alternate_time', 'open_availability', 'close_availability', 'add_buffer',
  'adjust_duration', 'add_staffing', 'move_break', 'fill_gap', 'resolve_overbooking', 'preserve_schedule',
]);
export const REVIEWABLE: SchedRecStatus[] = ['generated', 'review_required', 'review_in_progress'];
export const APPLYABLE: SchedRecStatus[] = ['accepted', 'customer_approved', 'application_pending'];
export const OPEN_STATUSES: SchedRecStatus[] = ['generated', 'review_required', 'review_in_progress', 'accepted', 'partially_accepted', 'needs_revision', 'customer_approval_required', 'customer_approved', 'application_pending', 'application_failed'];

export function statusTone(s: SchedRecStatus): { bg: string; fg: string } {
  if (s === 'applied' || s === 'accepted' || s === 'customer_approved') return { bg: '#E4F0E7', fg: '#3B6B47' };
  if (s === 'application_failed' || s === 'rejected') return { bg: '#F7DDD3', fg: '#B4451E' };
  if (s === 'customer_approval_required' || s === 'review_required' || s === 'generated' || s === 'review_in_progress') return { bg: '#FBEEDD', fg: '#9B6B1E' };
  return { bg: '#F3ECE1', fg: '#6C6965' };
}

/** [metric, label KEY (translate at render), format] */
export const METRIC_ROWS: [keyof SchedMetrics, string, (n: number) => string][] = [
  ['idleMin', 'pos.idle_time', (n) => tx('pos.n_min', { n: String(Math.round(n)) })],
  ['waitMin', 'pos.customer_wait', (n) => tx('pos.n_min', { n: String(Math.round(n)) })],
  ['utilizationPct', 'pos.utilization', (n) => `${Math.round(n)}%`],
  ['gapCount', 'ops.sched.metric.unusedGaps', (n) => String(n)],
  ['latenessRiskPct', 'ops.sched.metric.latenessRisk', (n) => `${Math.round(n)}%`],
];

/** One plain sentence for a server error the screen must explain (contract §2 error codes). */
/** `fallback` is a message KEY (ops.sched.err.*), read when the error has no text of its own */
export function schedErrorText(e: unknown, fallback = 'ops.sched.err.generic'): string {
  const err = e as { status?: number; code?: string; message?: string } | null;
  switch (err?.code) {
    case 'VERSION_CONFLICT': return tx('pos.someone_else_changed_this_recommendation_a_19nv');
    case 'STALE_SCHEDULE': return tx('pos.the_appointment_changed_after_this_was_19z0');
    case 'LOCKED_APPOINTMENT': return tx('pos.this_appointment_is_locked_checked_in_1y44');
    case 'MODULE_DISABLED': return tx('pos.the_optimizer_is_switched_off_for_16rn');
    case 'HARD_CONSTRAINT_VIOLATION': return tx('pos.that_change_breaks_a_hard_rule_68z6');
    case 'EXPIRED': case 'RECOMMENDATION_EXPIRED': return tx('pos.this_recommendation_expired_the_schedule_may_coth');
    default: break;
  }
  if (err?.status === 403) return tx('pos.you_do_not_have_permission_for_7x5k');
  if (err?.status === 402) return tx('pos.the_ai_scheduling_optimizer_package_is_otpj');
  return err?.message || tx(fallback);
}
/** 409s that mean "reload what you are looking at" */
export const isRefetchConflict = (e: unknown) => {
  const c = (e as { code?: string } | null)?.code;
  return c === 'VERSION_CONFLICT' || c === 'STALE_SCHEDULE';
};
/** the `violations` a 422 HARD_CONSTRAINT_VIOLATION carries (normalizeError puts the extra payload in `details`) */
export function violationsOf(e: unknown): SchedViolation[] {
  const x = e as { details?: { violations?: SchedViolation[]; error?: { violations?: SchedViolation[] } }; violations?: SchedViolation[] } | null;
  const v = x?.details?.violations ?? x?.details?.error?.violations ?? x?.violations;
  return Array.isArray(v) ? v : [];
}

export const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
export const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
export const th: React.CSSProperties = { textAlign: 'left', color: '#8A857E', fontWeight: 600, padding: '4px 6px', borderBottom: '1px solid var(--line)' };
export const td: React.CSSProperties = { padding: '5px 6px', borderBottom: '1px solid #F1E9DA', verticalAlign: 'top' };
export const SEV: Record<'info' | 'warning' | 'critical', { bg: string; fg: string }> = {
  info: { bg: '#F3ECE1', fg: '#6C6965' }, warning: { bg: '#FBEEDD', fg: '#9B6B1E' }, critical: { bg: '#F4CFC4', fg: '#8F2F13' },
};
