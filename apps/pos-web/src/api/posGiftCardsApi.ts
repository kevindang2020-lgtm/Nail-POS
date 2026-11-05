// posGiftCardsApi.ts — tenant gift-card management (read). Permission-gated pos.checkout.view server-side.
import { api } from "./client";
import type { StockItem, GiftCardBranchLiability, GiftCardClearingTransfer, GiftCardLiabilityReport } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export type { GiftCardBranchLiability, GiftCardClearingTransfer, GiftCardLiabilityReport };
export const posGiftCardsApi = {
  state: () => api.get(`/pos/gift-cards/state`),
  /** Decision 31: per-branch sold / redeemed / inter-branch clearing + tenant liability (reports permission). */
  liability: (from?: string, to?: string) => api.get<GiftCardLiabilityReport>(`/pos/gift-cards/liability` + (from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : '')),
};
import type { StockCounts } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)

// Physical gift-card inventory (spec §21). Permission-gated pos.checkout.gift_card_issue server-side.
export interface StockState { counts: StockCounts; items: StockItem[]; lowStock: boolean; lowStockThreshold: number }

export const posGiftCardStockApi = {
  state: () => api.get<StockState>(`/pos/gift-cards/stock`),
  register: (numbers: string, batchLabel?: string) => api.post<{ added: number; duplicates: number; invalid: number }>(`/pos/gift-cards/stock/register`, { numbers, batchLabel }),
  voidCard: (id: string) => api.post<{ ok: boolean }>(`/pos/gift-cards/stock/${encodeURIComponent(id)}/void`, {}),
};
export type { StockItem };
export type { StockCounts };
