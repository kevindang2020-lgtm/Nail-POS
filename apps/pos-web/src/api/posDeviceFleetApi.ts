// posDeviceFleetApi — SUNMI batch 8 (Nov 9 2026): the read model over the real device registries (/pos/device-fleet/*).
import { api } from './client';
import type { DfSummary, DfListResponse, DfHistoryResponse, DfCheckResponse, DfClass, ReceiptPrinter } from '@aipowersalon/api-contracts/tenant';
export type { ReceiptPrinter };
export type PrinterInput = { name?: string; connection?: ReceiptPrinter['connection']; address?: string | null; paperWidthMm?: 58 | 80; posStationId?: string | null; status?: 'active' | 'disabled' };

export type DeviceFleetQuery = { class: DfClass; q?: string; status?: string; dateField?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
export type DeviceHistoryQuery = { class: DfClass; deviceId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number };
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all' || false)) as Record<string, string>;

export const posDeviceFleetApi = {
  summary: (cls: DfClass) => api.get<DfSummary>('/pos/device-fleet/summary', { class: cls }),
  devices: (q: DeviceFleetQuery) => api.get<DfListResponse>('/pos/device-fleet/devices', { ...clean(q), class: q.class }),
  history: (q: DeviceHistoryQuery) => api.get<DfHistoryResponse>('/pos/device-fleet/history', { ...clean(q), class: q.class }),
  check: (cls: DfClass) => api.post<DfCheckResponse>('/pos/device-fleet/check', { class: cls }),
  // batch 8 decision 2: receipt-printer RECORDS (no print bridge — nothing here prints)
  addPrinter: (b: Omit<PrinterInput, 'status'>) => api.post<ReceiptPrinter>('/pos/receipt-printers', b as Record<string, unknown>),
  updatePrinter: (id: string, b: PrinterInput) => api.patch<ReceiptPrinter>(`/pos/receipt-printers/${encodeURIComponent(id)}`, b as Record<string, unknown>),
  retirePrinter: (id: string) => api.post<ReceiptPrinter>(`/pos/receipt-printers/${encodeURIComponent(id)}/retire`, {}),
};
