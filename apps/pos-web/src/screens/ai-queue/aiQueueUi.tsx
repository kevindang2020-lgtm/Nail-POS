// aiQueueUi.tsx — shared look + small helpers for the AI Queue Assignment workspace (BUILD_PLAN Phase 6).
// Champagne Gold through the existing tokens; plain-language labels for every machine value the API returns.
import type React from 'react';
import { ApiError, type AqBlockedBy, type AqAlert, type AqRepairAction } from '../../api/posAIQueueAssignmentApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabelOrNull, humanizeCode } from '../../i18n/status-label';
import { fmtInZone } from '../../i18n/format';
import { growthCode } from '../growthLabels';
export const GOLD = '#A96F22';
export const card: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 16, minWidth: 0 };
export const cardHead: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 12, fontFamily: 'var(--aps-font-head, Playfair Display)', color: '#2C2A27', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
export const input: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', fontSize: 13, fontFamily: 'inherit', minWidth: 0 };
export const btnGold: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
export const btnGhost: React.CSSProperties = { height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', color: '#4A4744', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
export const btnDanger: React.CSSProperties = { ...btnGhost, color: '#B4451E', borderColor: '#E7C6BB' };
export const muted: React.CSSProperties = { color: '#8A857E', fontSize: 12.5 };
export const errText: React.CSSProperties = { color: '#B4451E', fontSize: 12.5 };
export const okText: React.CSSProperties = { color: '#3E8F57', fontSize: 12.5 };
export const pill = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' });
export const SEV_TONE: Record<string, { bg: string; fg: string }> = { info: { bg: '#F3ECE1', fg: '#6C6965' }, warning: { bg: '#FBEEDD', fg: '#9B6B1E' }, high: { bg: '#F7DDD3', fg: '#B4451E' }, severe: { bg: '#F7DDD3', fg: '#B4451E' }, critical: { bg: '#F4CFC4', fg: '#8F2F13' } };

export const pretty = (s: string | null | undefined) => growthCode(s, ['aiQueue', 'turnReason', 'queueItem']);
/** an alert severity code as a word in the POS language */
export const severityLabel = (s: string | null | undefined) => statusLabelOrNull('level', s) ?? (s ? (t(`growth.aiQueue.severity.${s}`) !== `growth.aiQueue.severity.${s}` ? t(`growth.aiQueue.severity.${s}`) : humanizeCode(s)) : '');
export const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${Math.round(n * 100)}%`);
export const mins = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : t('pos.n_min', { n: String(Math.round(n)) }));
export const errMsg = (e: unknown, fallback = t('growth.aiQueue.actionFailed')) => (e instanceof ApiError || e instanceof Error ? e.message || fallback : fallback);
export const when = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtInZone(d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

/** Why an auto-run may not act right now — one plain sentence (contract §B `autoBlockedBy`). */
export function autoOffReason(blockedBy: AqBlockedBy | undefined, salonReason?: string | null): string | null {
  if (blockedBy === 'platform') return t('pos.auto_assign_is_off_because_the_18rm');
  if (blockedBy === 'salon_kill_switch') return t('pos.auto_assign_is_off_because_the_etxl', { v0: String(salonReason ? ` (“${salonReason}”)` : '') });
  if (blockedBy === 'disabled') return t('pos.auto_assign_is_off_because_it_k6ft');
  if (blockedBy === 'mode') return t('pos.auto_assign_is_off_because_the_m56f');
  return null;
}

/** Closed alerts are `status: 'resolved'` (ops alerts repository) — never offered an action (audit bug 9). */
export const isClosedAlert = (a: AqAlert) => a.status === 'resolved';
/** The scan closed it because the condition cleared: `autoResolved` (resolution 'condition_cleared'). */
export const isAutoResolved = (a: AqAlert) => a.autoResolved === true || (a as { auto_resolved?: boolean }).auto_resolved === true || a.resolution === 'condition_cleared';
export function alertStatusLabel(a: AqAlert): string {
  if (isAutoResolved(a)) return t('pos.auto_resolved_the_condition_cleared');
  if (a.status === 'resolved') {
    if (a.resolution === 'dismissed') return t('growth.aiQueue.alert.dismissed');
    if (a.resolution?.startsWith('repaired:')) return t('pos.repaired_v0', { v0: String(REPAIR_DONE[a.resolution.slice(9) as AqRepairAction] || pretty(a.resolution.slice(9))) });
    return t('growth.aiQueue.alert.resolved');
  }
  if (a.status === 'acknowledged') return t('growth.aiQueue.alert.acknowledged');
  return t('growth.aiQueue.alert.open');
}

/** The repairs the server allows per alert type — the same table as REPAIRS_BY_TYPE in
 *  modules/ai/src/ai-queue-assignment/ai-queue-assignment-alerts.service.ts (the server refuses anything else). */
export const ALERT_REPAIRS: Record<string, AqRepairAction[]> = {
  waiting_too_long: ['call', 'reassign', 'dismiss'],
  unassigned: ['reassign', 'dismiss'],
  stuck_record: ['unassign', 'reassign', 'call', 'start_service', 'move_to_tech_queue', 'cancel', 'dismiss'],
  late_appointment: ['call', 'start_service', 'reassign', 'dismiss'],
  long_service: ['dismiss'],
  overloaded_technician: ['reassign', 'dismiss'],
  congestion: ['dismiss'],
};
export const repairsFor = (type: string): AqRepairAction[] => ALERT_REPAIRS[type] ?? ['dismiss'];
const REPAIR_DONE: Record<AqRepairAction, string> = { get unassign() { return t('growth.aiQueue.repairDone.unassign'); }, get reassign() { return t('growth.aiQueue.repairDone.reassign'); }, get call() { return t('growth.aiQueue.repairDone.call'); }, get start_service() { return t('growth.aiQueue.repairDone.start_service'); }, get move_to_tech_queue() { return t('growth.aiQueue.repairDone.move_to_tech_queue'); }, get cancel() { return t('growth.aiQueue.repairDone.cancel'); }, get dismiss() { return t('growth.aiQueue.repairDone.dismiss'); } };
export const REPAIR_LABEL: Record<AqRepairAction, string> = {
  get unassign() { return t('growth.aiQueue.repair.unassign'); }, get reassign() { return t('growth.aiQueue.repair.reassign'); }, get call() { return t('growth.aiQueue.repair.call'); },
  get start_service() { return t('growth.aiQueue.repair.start_service'); }, get move_to_tech_queue() { return t('growth.aiQueue.repair.move_to_tech_queue'); }, get cancel() { return t('growth.aiQueue.repair.cancel'); }, get dismiss() { return t('growth.aiQueue.repair.dismiss'); },
};

/** The feedback a reject must carry (contract §B `feedbackCode`). */
export const FEEDBACK_CODES = (): [string, string][] => [
  ['customer_preference', t('growth.aiQueue.feedback.customer_preference')],
  ['wrong_skill', t('growth.aiQueue.feedback.wrong_skill')],
  ['technician_busy', t('growth.aiQueue.feedback.technician_busy')],
  ['appointment_conflict', t('growth.aiQueue.feedback.appointment_conflict')],
  ['fairness_rotation', t('growth.aiQueue.feedback.fairness_rotation')],
  ['station_or_equipment', t('growth.aiQueue.feedback.station_or_equipment')],
  ['other', t('growth.aiQueue.feedback.other')],
];
export const DECISION_LABEL: Record<string, string> = { get accepted() { return t('growth.aiQueue.decision.accepted'); }, get rejected() { return t('growth.aiQueue.decision.rejected'); }, get overridden() { return t('growth.aiQueue.decision.overridden'); }, get kept_unassigned() { return t('growth.aiQueue.decision.kept_unassigned'); }, get auto_assigned() { return t('growth.aiQueue.decision.auto_assigned'); } };
// Fair Turn Engine (wave 2): the five fairness modes run the Fair Turn pipeline; the legacy five keep the scoring engine.
// Oct 13 2026 (FLOW T1): the five fairness modes of the ONE Fair Turn Engine. The legacy scoring policies (hybrid,
// least_minutes, least_customers, first_available, fixed_order) are read by the server as their fairness mode.
export const ROTATION = (): [string, string][] => [['traditional_weighted_rotation', t('growth.aiQueue.rotation.traditional_weighted_rotation')], ['lowest_turn_units', t('growth.aiQueue.rotation.lowest_turn_units')], ['workload_balanced', t('growth.aiQueue.rotation.workload_balanced')], ['hybrid_fairness', t('growth.aiQueue.rotation.hybrid_fairness')], ['manual_order', t('growth.aiQueue.rotation.manual_order')]];

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontWeight: 800, fontSize: 20, color: tone || '#2C2A27', fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{value}</div>
      <div style={{ color: '#8A857E', fontSize: 12 }}>{label}</div>
    </div>
  );
}
