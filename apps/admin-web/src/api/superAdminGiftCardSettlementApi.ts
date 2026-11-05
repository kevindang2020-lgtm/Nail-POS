// superAdminGiftCardSettlementApi.ts — typed client for Super-Admin cross-tenant clearing settlement (§16/§33).
// Outstanding obligations + per-salon receivable/payable, plus grouping them into human-reviewed settlement batches.
import { api } from './client';
import type { TenantPosition } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

export interface ClearingEntry { id: string; programId: string | null; issuingTenantId: string; redeemingTenantId: string; amountCents: number; platformFeeCents: number; status: string; createdAt: string }
export interface SettlementBatch { id: string; programId: string | null; status: string; totalCents: number; feeCents: number; netCents: number; approvedByUserId: string | null; approvedAt: string | null; createdAt: string; entryCount: number }
export interface SettlementState {
  pending: { count: number; totalCents: number; feeCents: number; netCents: number; entries: ClearingEntry[] };
  batches: SettlementBatch[];
  positions: TenantPosition[];
}

export const giftCardSettlementApi = {
  state: () => api.get<SettlementState>('/super-admin/gift-cards/settlement'),
  createBatch: (body: { programId?: string | null; entryIds?: string[] } = {}) => api.post<SettlementBatch>('/super-admin/gift-cards/settlement/batches', body),
  batch: (id: string) => api.get<{ batch: SettlementBatch; entries: ClearingEntry[] }>(`/super-admin/gift-cards/settlement/batches/${encodeURIComponent(id)}`),
  setBatchStatus: (id: string, status: string) => api.patch<SettlementBatch>(`/super-admin/gift-cards/settlement/batches/${encodeURIComponent(id)}`, { status }),
};
export type { TenantPosition };
