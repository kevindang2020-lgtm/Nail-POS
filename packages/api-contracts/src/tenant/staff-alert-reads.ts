// staff-alert-reads.ts — per-person read state for salon alerts + the cross-device badge-sync monitor (extras round 9:
// AI BUSINESS ALERTS 05, Global Loyalty Rewards 08, Customer Notifications 04).
//
// "Read" is one person's "I have seen this" (staff_alert_reads). It is NOT the alert's lifecycle: acknowledging /
// resolving an alert (owner_alerts.status) stays a separate, salon-wide act. Marking read never changes the alert.

/** owner_alerts lifecycle, shown beside the read state (never changed by a read). */
export type StaffAlertLifecycle = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed';

export interface StaffAlertItem {
  alertId: string;
  /** owner_alerts.category, e.g. loyalty | ai_business_alert | messaging_failure */
  category: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  title: string;
  lifecycleStatus: StaffAlertLifecycle;
  createdAt: string;
  /** when THIS person read it; null = unread for this person */
  readAt: string | null;
}
export interface StaffAlertList {
  generatedAt: string;
  /** unread for this person among live alerts (new / acknowledged / in progress) of the last windowDays */
  unread: number;
  windowDays: number;
  items: StaffAlertItem[];
}
export interface StaffAlertMarkReadResponse {
  /** alerts newly marked read for this person (already-read ones are not counted twice) */
  marked: number;
  /** this person's unread count after the change */
  unread: number;
  /** always false: a read never touches the alert's lifecycle */
  lifecycleChanged: false;
}

export type BadgeSyncState = 'in_sync' | 'behind' | 'stale' | 'broken' | 'never';
export interface BadgeSyncSession {
  /** last 6 characters of the session id — enough to tell devices apart, never the full id */
  sessionRef: string;
  current: boolean;
  deviceName: string | null;
  platform: string | null;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  lastUnread: number | null;
  syncCount: number;
  state: BadgeSyncState;
}
export interface BadgeSyncMonitor {
  generatedAt: string;
  /** the unread count the server computes now — what every in-sync device should show */
  currentUnread: number;
  staleAfterMinutes: number;
  sessions: BadgeSyncSession[];
  summary: Record<BadgeSyncState, number>;
}
export interface BadgeSyncRecorded { recordedAt: string; sessionRef: string }
