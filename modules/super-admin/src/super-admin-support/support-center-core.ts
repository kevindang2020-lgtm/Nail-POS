// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { SlaStatus } from '@aipowersalon/api-contracts/platform';
import { SLA_STATUSES } from '@aipowersalon/api-contracts/platform';
export { SLA_STATUSES };   // the one list, in the contract beside its type
import type { SlaStatus } from '@aipowersalon/api-contracts/platform';
// support-center-core.ts — pure, I/O-free logic for the Super Admin Support Center dashboard. No DB, no clock, no
// network. Controlled vocabularies + derivations that reconcile to the real support_tickets / support_access_sessions /
// help_articles rows. SLA status and session status are DERIVED from real fields (there is no stored sla_status or
// session status column), and anything genuinely unmodeled (CSAT, actual first-response time) is left to render as —.

// ---- controlled vocabularies (mirror the DB CHECK constraints) ---------------------------------------------------
export const PRIORITIES = ['critical', 'urgent', 'high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const TICKET_STATUSES = ['draft', 'submitted', 'open', 'assigned', 'waiting_support', 'waiting_customer', 'in_progress', 'escalated', 'resolved', 'closed', 'reopened', 'canceled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const SESSION_STATUSES = ['active', 'expiring_soon', 'completed', 'expired', 'revoked'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const KB_STATUSES = ['draft', 'in_review', 'published', 'archived', 'retired'] as const;

// Tickets that count as "open" (active work), "urgent", "assigned", and terminal.
const ACTIVE_STATUSES = new Set<TicketStatus>(['submitted', 'open', 'assigned', 'waiting_support', 'waiting_customer', 'in_progress', 'escalated', 'reopened']);
const TERMINAL_STATUSES = new Set<TicketStatus>(['resolved', 'closed', 'canceled']);
export const isActiveTicket = (s: string): boolean => ACTIVE_STATUSES.has(s as TicketStatus);
export const isTerminalTicket = (s: string): boolean => TERMINAL_STATUSES.has(s as TicketStatus);
export const isUrgentPriority = (p: string): boolean => p === 'critical' || p === 'urgent' || p === 'high';

// ---- SLA status derivation (first-response proxy from response_target_minutes + age + status) --------------------
const NEAR_BREACH_FRACTION = 0.8;
export function slaStatusOf(status: string, responseTargetMinutes: number | null, createdAtMs: number, nowMs: number): SlaStatus {
  if (isTerminalTicket(status)) return 'not_applicable';
  if (status === 'waiting_customer') return 'paused';        // SLA pauses while waiting on the tenant (policy)
  if (!responseTargetMinutes || responseTargetMinutes <= 0) return 'not_applicable';
  const elapsedMin = (nowMs - createdAtMs) / 60000;
  if (elapsedMin >= responseTargetMinutes) return 'breached';
  if (elapsedMin >= responseTargetMinutes * NEAR_BREACH_FRACTION) return 'near_breach';
  return 'on_track';
}

// ---- controlled support-session derivation (no stored status/access_level columns) ------------------------------
const EXPIRING_SOON_MS = 5 * 60 * 1000;
export function sessionStatusOf(expiresAtMs: number, endedAtMs: number | null, nowMs: number): SessionStatus {
  if (endedAtMs != null) return endedAtMs < expiresAtMs ? 'revoked' : 'completed';   // ended before expiry ⇒ manually revoked
  if (nowMs >= expiresAtMs) return 'expired';
  if (expiresAtMs - nowMs <= EXPIRING_SOON_MS) return 'expiring_soon';
  return 'active';
}
/** Audit status shown in the Recent Audited Support Sessions table (mapped from the derived session status). */
export function sessionAuditStatus(s: SessionStatus): 'Completed' | 'Active' | 'Expired' | 'Revoked' {
  switch (s) { case 'active': case 'expiring_soon': return 'Active'; case 'expired': return 'Expired'; case 'revoked': return 'Revoked'; default: return 'Completed'; }
}
export function durationMinutes(startedAtMs: number, endedAtMs: number | null, nowMs: number): number {
  const end = endedAtMs ?? nowMs;
  return Math.max(0, Math.round((end - startedAtMs) / 60000));
}

// ---- rollups -----------------------------------------------------------------------------------------------------
export function distribution<T extends string>(items: { key: T; count: number }[]): { total: number; slices: { key: T; count: number; pct: number }[] } {
  const total = items.reduce((a, i) => a + i.count, 0);
  return { total, slices: items.map((i) => ({ key: i.key, count: i.count, pct: total ? Math.round((i.count / total) * 1000) / 10 : 0 })) };
}
export const avg = (nums: number[]): number | null => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

// Whether an INCREASE is favorable. Absent ⇒ neutral (monitored, not "good").
export const INCREASE_GOOD: Record<string, boolean> = {
  openTickets: false, urgentTickets: false, slaBreaches: false, avgFirstResponseMin: false,
  resolvedToday: true, ticketCsat: true, knowledgeArticles: true,
  // assignedTickets, waitingForCustomer, auditedSessions, supportSessionsStarted ⇒ neutral (monitored access activity).
};
export interface Trend { delta: number; favorable: boolean | null }
export function trendOf(metric: string, delta: number): Trend {
  const good = INCREASE_GOOD[metric];
  const favorable = delta === 0 || good === undefined ? null : good ? delta > 0 : delta < 0;
  return { delta, favorable };
}
