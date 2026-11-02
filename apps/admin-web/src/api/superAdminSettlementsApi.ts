import type { FundingExceptionType, ReconciliationStatus, SettlementRow, SettlementStatus } from '@aipowersalon/api-contracts/platform';
export type { FundingExceptionType, ReconciliationStatus, SettlementRow, SettlementStatus };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';
import type { SettlementsOverview } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

export interface SettlementsQuery {
  page?: number; pageSize?: number; search?: string; tenantId?: string; branchId?: string; processor?: string;
  settlementStatus?: string; reconciliationStatus?: string; fundingLast4?: string; startDate?: string; endDate?: string;
  sort?: string; direction?: 'asc' | 'desc'; selectedId?: string;
}

export const superAdminSettlementsApi = {
  overview: (q?: SettlementsQuery) => api.get<{ ok: true } & SettlementsOverview>('/super-admin/settlements/overview', q as Record<string, unknown> | undefined),
  addNote: (id: string, body: { category?: string; body: string; supportCaseId?: string | null }) => api.post<{ ok: boolean; error?: string }>(`/super-admin/settlements/${id}/notes`, body),
  resolve: (id: string, body: { resolutionCategory: string; reason: string }) => api.post<{ ok: boolean; error?: string }>(`/super-admin/settlements/${id}/resolve`, body),
  processorCase: (id: string, body: { category?: string; severity?: string; description?: string }) => api.post<{ ok: boolean; error?: string }>(`/super-admin/settlements/${id}/processor-case`, body),
  matchDeposit: (id: string, body: { actualCents: number; actualDate?: string; depositRef?: string }) => api.post<{ ok: boolean; error?: string }>(`/super-admin/settlements/${id}/match-deposit`, body),
  exportCsv: (q?: SettlementsQuery) => api.exportAsync<Blob>('/super-admin/settlements/export', q as Record<string, unknown> | undefined, 'blob'),
  exportXlsx: (q?: SettlementsQuery) => api.exportAsync<Blob>('/super-admin/settlements/export-xlsx', q as Record<string, unknown> | undefined, 'blob'),
};
export type { SettlementsOverview };
