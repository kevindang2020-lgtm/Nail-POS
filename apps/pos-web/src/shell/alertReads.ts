// alertReads.ts — extras round 9: per-person alert read state + cross-device badge sync (AI BUSINESS ALERTS 05, Global Loyalty
// Rewards 08, Customer Notifications 04). A read is MY "seen" — it never acknowledges or resolves the alert (the server keeps
// the two apart). After a read this tab re-reads its badges ('aps:nav-counts-changed') and tells the person's other tabs
// in this browser (BroadcastChannel); other devices read the same server-side state on their next badge sync, and the
// Badge check's Devices list shows whether they did.
import { api } from '../api/client';
import type { BadgeSyncMonitor, StaffAlertList, StaffAlertMarkReadResponse } from '@aipowersalon/api-contracts/tenant';

export const ALERT_READS_CHANNEL = 'aps-alert-reads';
export const NAV_COUNTS_CHANGED = 'aps:nav-counts-changed';

export const alertReadsApi = {
  list: (q: { category?: string; limit?: number } = {}) => api.get<StaffAlertList>('/tenant/notifications/alerts', q as Record<string, unknown>),
  markRead: (alertIds: string[]) => api.post<StaffAlertMarkReadResponse>('/tenant/notifications/alerts/read', { alertIds }),
  sync: (unread: number) => api.post<{ recordedAt: string; sessionRef: string }>('/tenant/navigation/badges/sync', { unread, surface: 'pos' }),
  monitor: () => api.get<BadgeSyncMonitor>('/tenant/navigation/badge-sync'),
};

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(ALERT_READS_CHANNEL) : null;
}

/** Mark alerts read for me, then make this tab and my other tabs re-read their badges. Returns the server's answer. */
export async function markAlertsReadEverywhere(alertIds: string[]): Promise<StaffAlertMarkReadResponse> {
  const r = await alertReadsApi.markRead(alertIds);
  window.dispatchEvent(new Event(NAV_COUNTS_CHANGED));
  const ch = channel();
  if (ch) { ch.postMessage({ kind: 'read', at: Date.now() }); ch.close(); }
  return r;
}

/** Another tab of mine read an alert → re-read badges here. Returns the unsubscribe. */
export function onAlertReadsElsewhere(fn: () => void): () => void {
  const ch = channel();
  if (!ch) return () => undefined;
  ch.onmessage = () => fn();
  return () => ch.close();
}
