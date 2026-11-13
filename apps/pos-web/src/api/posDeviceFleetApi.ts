// posDeviceFleetApi — SUNMI batch 8 (Nov 9 2026): the read model over the real device registries (/pos/device-fleet/*).
import { api } from './client';
import type { DfSummary, DfListResponse, DfHistoryResponse, DfCheckResponse, DfClass } from '@aipowersalon/api-contracts/tenant';

export type DeviceFleetQuery = { class: DfClass; q?: string; status?: string; dateField?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
export type DeviceHistoryQuery = { class: DfClass; deviceId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number };
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all' || false)) as Record<string, string>;

export const posDeviceFleetApi = {
  summary: (cls: DfClass) => api.get<DfSummary>('/pos/device-fleet/summary', { class: cls }),
  devices: (q: DeviceFleetQuery) => api.get<DfListResponse>('/pos/device-fleet/devices', { ...clean(q), class: q.class }),
  history: (q: DeviceHistoryQuery) => api.get<DfHistoryResponse>('/pos/device-fleet/history', { ...clean(q), class: q.class }),
  /** extras Tablets 11 — the redacted inventory + health CSV (owners / managers; audited); same filters as devices() */
  exportCsv: (q: DeviceFleetQuery) => api.exportAsync<string>('/pos/device-fleet/export', { ...clean(q), class: q.class }, 'text'),
  check: (cls: DfClass) => api.post<DfCheckResponse>('/pos/device-fleet/check', { class: cls }),
};
