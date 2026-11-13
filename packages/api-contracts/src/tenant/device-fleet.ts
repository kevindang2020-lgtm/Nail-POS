// device-fleet.ts — wire types for /pos/device-fleet/* (SUNMI batch 8, Nov 9 2026): one read model over the real device
// registries (registers, kiosks, displays, terminals). Read-only; no secret, token or full serial ever leaves.
export type DfClass = 'all' | 'reception_pos' | 'kiosk' | 'tablet' | 'display' | 'terminal' | 'receipt';
export type DfStatus = 'online' | 'offline' | 'attention' | 'pending' | 'disabled' | 'revoked' | 'retired' | 'maintenance' | 'unknown' | 'unassigned';
export interface DfDevice {
  id: string; source: 'station' | 'kiosk' | 'display' | 'terminal'; class: DfClass; name: string; type: string;
  branchId: string | null; branch: string | null; station: string | null; status: DfStatus; reason: string | null;
  lastSeenAt: string | null; createdAt: string | null; updatedAt: string | null; facts: Record<string, unknown>;
}
export interface DfSummary {
  class: DfClass; checkedAt: string; registered: number; online: number; attention: number; unassigned: number; disabled: number; retired: number;
  extra: Record<string, unknown>;
}
export interface DfListResponse {
  class: DfClass; items: DfDevice[]; total: number; page: number; pageSize: number; totalPages: number; checkedAt: string;
  applied: { q: string | null; status: string; branchId: string | null; from: string | null; to: string | null; dateField: string; sort: string };
}
export interface DfHistoryItem { id: string; at: string; event: string; entity: string; deviceId: string | null; actor: string | null; actorRole: string | null; source: string }
export interface DfReceiptEvent { id: string; at: string; choice: string; status: string | null; ticket: string | null; station: string | null }
export interface DfHistoryResponse { class: DfClass; items: DfHistoryItem[]; receipts?: DfReceiptEvent[]; total: number; page: number; pageSize: number; totalPages: number }
export interface DfCheckResponse {
  class: DfClass; overall: 'READY' | 'WARNING' | 'FAILED' | 'NOT_CONFIGURED'; checkedAt: string;
  checks: { key: string; state: 'READY' | 'WARNING' | 'FAILED' | 'NOT_CONFIGURED'; count?: number }[];
}

/** Device Integration Logs backlog · 05 (Nov 12 2026): automated, deduplicated device / integration alerts. Each rule keeps
 *  ONE open alert per key in the salon's existing alert feed (owner_alerts, category device_integration) — a repeat detection
 *  updates it, a resolved one is not reopened inside the cooldown (critical excepted); a rule is never switched off by
 *  the system. Counts and device names only — never customer data, payloads or secrets. */
export type DfAlertRule = 'device_offline' | 'terminal_unavailable' | 'sync_failures' | 'provider_critical';
export interface DfAlert {
  id: string; rule: DfAlertRule; severity: string; status: string; dedupeKey: string; deviceClass: string | null; source: string | null;
  count: number; names: string[]; action: string; firstEventAt: string | null; lastEventAt: string | null; detections: number;
  openedAt: string | null; updatedAt: string | null; resolvedAt: string | null; resolvedBy: string | null;
}
export interface DfAlertsResponse {
  items: DfAlert[]; page: number; pageSize: number; totalItems: number; totalPages: number;
  evaluatedAt: string | null; cooldownMinutes: number; canResolve: boolean;
}
