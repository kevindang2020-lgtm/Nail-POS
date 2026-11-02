// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface ActivityMetric<T = number> { value: T | null; available: boolean; reason?: string; }

// ── Communications / SMS Inbox (Oct 30 2026) — the shapes the POS reads from pos/communications/inbox/* ──────────────
/** the period the server resolved in the SALON's time zone (from / to = local YYYY-MM-DD; null = all time) */
export interface InboxPeriod { preset: 'all' | 'today' | 'week' | 'month' | 'year' | 'custom'; from: string | null; to: string | null; tz: string; today: string }
export type InboxTimelineSource = 'message' | 'automated' | 'review_request' | 'call' | 'ai_follow_up' | 'appointment';
/** one entry of the unified customer timeline — joined from the canonical records, never copied */
export interface InboxTimelineEvent {
  id: string; source: InboxTimelineSource; type: string; channel: 'sms' | 'email' | 'call' | 'app' | 'none';
  direction: 'inbound' | 'outbound' | 'none'; actorKind: 'customer' | 'staff' | 'ai' | 'system';
  actorName: string | null; at: string; state: string | null; body: string | null; summary: string | null;
  ref: { kind: string; id: string } | null; threadId: string | null; errorCode: string | null;
}

export type ReminderChannel = 'sms' | 'email';
/** ladderMinutes (Oct 21 2026): the reminder ladder, minutes before the start, longest first (24 h / 2 h / 30 min = [1440, 120, 30]);
 *  a salon that never set it keeps leadMinutes as its one rung. */
export interface ReminderConfig { tenantId: string; enabled: boolean; leadMinutes: number; windowMinutes: number; channel: ReminderChannel; ladderMinutes?: number[] | null }
export type NotificationChannel = 'sms' | 'email';
export interface OptOutRow {
  tenantId: string; channel: NotificationChannel; address: string; reason: string | null; optedOutAt: string;
}

export interface SendNotificationResult {
  sent: boolean;
  /** 'simulated' (P-11): no provider outside production — recorded, nothing sent, never charged. A channel with no
   *  provider in production answers sent=false, status 'blocked', reason 'not_configured'. */
  status: 'sent' | 'failed' | 'blocked' | 'delivered' | 'simulated';
  simulated?: boolean;
  id?: string;
  providerId?: string;
  reason?: string;        // 'over_limit' | 'invalid' | provider error
  remainingCredits?: number;
}
