// posDevicesApi.ts — client for the tenant Devices & Integrations overview aggregate (/pos/devices/*).
// Read-only; the server derives tenant/branch from the session. Metrics with no canonical source come back null
// and are listed in dataQuality.metricsUnavailable so the screen renders honest "—"/empty instead of fake values.
import type { DeviceStatus, DevicesKpis, DevicesOverview, FleetDevice, TerminalView } from '@aipowersalon/api-contracts/tenant';
export type { DeviceStatus, DevicesKpis, DevicesOverview, FleetDevice, TerminalView };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';

/** One row of the payment-terminal registry (GET /pos/settings/payments-checkout/terminals; wave 3 PAYI). */
export type TerminalRegistryRow = {
  id: string; label: string; stationId?: string; registerName?: string; status: 'paired' | 'unpaired'; pairedAt?: string; hsn?: string;
  provider?: string | null; terminalType?: string | null; serialNumber?: string | null; connectionType?: string | null; merchantAccountId?: string | null;
  operationalStatus?: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PROCESSING' | 'DEGRADED' | 'DISABLED' | 'UNKNOWN'; operationalLabel?: string;
  lastSeenAt?: string | null; lastTransactionAt?: string | null; lastPingAt?: string | null; lastPingOk?: boolean | null;
  disabledAt?: string | null; disabledReason?: string | null;
};



export const posDevicesApi = {
  overview: () => api.get<DevicesOverview>('/pos/devices/overview'),

  // --- customer-display actions: the fleet IS the salon's customer displays (customer_display_devices). Pairing and every
  //     device action live in Devices → Customer Displays (/pos/customer-displays, 23-inch spec §8–§12, §82, §86); the old
  //     "Test" / "status" calls stamped last_seen_at from the POS (a dead display looked online) and are gone. ---
  refreshDevice: (id: string) => api.post<{ requested: true; online: boolean }>(`/pos/customer-displays/${encodeURIComponent(id)}/refresh`),
  revokeDevice: (id: string) => api.post<{ revoked: true }>(`/pos/customer-displays/${encodeURIComponent(id)}/revoke`),

  // --- terminal actions (reuse the existing pos/settings payments-checkout/terminals endpoints) ---
  /** wave 3 PAYI §11/§12/§50/§52: the terminal REGISTRY (normalized status, last seen / transaction, type, disabled) */
  terminals: () => api.get<TerminalRegistryRow[]>('/pos/settings/payments-checkout/terminals'),
  testTerminal: (id: string) => api.get<{ id: string; reachable: boolean; detail: string; probed?: boolean }>(`/pos/settings/payments-checkout/terminals/${id}/test`),
  renameTerminal: (id: string, b: { label?: string; terminalType?: string | null; serialNumber?: string | null; connectionType?: string | null }) => api.post<TerminalRegistryRow>(`/pos/settings/payments-checkout/terminals/${encodeURIComponent(id)}/rename`, b),
  disableTerminal: (id: string, reason: string) => api.post<TerminalRegistryRow>(`/pos/settings/payments-checkout/terminals/${encodeURIComponent(id)}/disable`, { reason }),
  enableTerminal: (id: string) => api.post<TerminalRegistryRow>(`/pos/settings/payments-checkout/terminals/${encodeURIComponent(id)}/enable`, {}),
  unpairTerminal: (id: string) => api.post(`/pos/settings/payments-checkout/terminals/${id}/unpair`, {}),
  pairTerminal: (b: { code: string; label: string; stationId?: string; hsn?: string }) => api.post<{ id: string; status: string }>(`/pos/settings/payments-checkout/terminals/pair`, b),
  /** Oct 6 2026: the register a terminal serves (one of this location's registers, or null) — its card charges use it. */
  setTerminalRegister: (id: string, stationId: string | null) => api.post<{ id: string; stationId?: string; registerName?: string }>(`/pos/settings/payments-checkout/terminals/${encodeURIComponent(id)}/register`, { stationId }),
};
