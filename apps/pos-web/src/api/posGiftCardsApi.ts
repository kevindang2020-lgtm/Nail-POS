// posGiftCardsApi.ts — tenant gift-card management (read). Permission-gated pos.checkout.view server-side.
import { api } from "./client";
import type { StockItem, GiftCardBranchLiability, GiftCardClearingTransfer, GiftCardLiabilityReport } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export type { GiftCardBranchLiability, GiftCardClearingTransfer, GiftCardLiabilityReport };
export const posGiftCardsApi = {
  state: () => api.get(`/pos/gift-cards/state`),
  /** Decision 31: per-branch sold / redeemed / inter-branch clearing + tenant liability (reports permission). */
  liability: (from?: string, to?: string) => api.get<GiftCardLiabilityReport>(`/pos/gift-cards/liability` + (from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : '')),
  // Gift Cards mandate (Oct 29 2026): the screen's read model — masked identifiers only, server-paged, KPIs over every card
  list: (q: Record<string, unknown>) => api.get<any>(`/pos/gift-cards/list`, cleanQ(q)),
  summary: (q: Record<string, unknown>) => api.get<any>(`/pos/gift-cards/summary`, cleanQ(q)),
  detail: (cardId: string) => api.get<any>(`/pos/gift-cards/${encodeURIComponent(cardId)}/detail`),
  ledger: (cardId: string, q: Record<string, unknown>) => api.get<any>(`/pos/gift-cards/${encodeURIComponent(cardId)}/ledger`, cleanQ(q)),
  exportCsv: (q: Record<string, unknown>) => api.exportAsync<string>(`/pos/gift-cards/export`, cleanQ(q), 'text'),
  // the writer's routes (modules/checkout): payment-first Issue / Reload (each opens its own ticket, paid at Checkout) and the
  // manager's reasoned void (step-up). A card is addressed by its id — never by its redeemable code.
  issue: (b: { customerId: string; amountCents: number; delivery: 'digital' | 'physical'; cardNumber?: string; pin?: string; idempotencyKey: string; recipient?: { name?: string; phone?: string; email?: string; message?: string } }) =>
    api.post<any>(`/pos/checkout/gift-cards/issue`, b as Record<string, unknown>),
  reload: (cardId: string, b: { amountCents: number; customerId?: string; idempotencyKey: string }) => api.post<any>(`/pos/checkout/gift-cards/${encodeURIComponent(cardId)}/reload-ticket`, b),
  voidCard: (cardId: string, reason: string) => api.post<any>(`/pos/checkout/gift-cards/${encodeURIComponent(cardId)}/void-card`, { reason }),
};
const cleanQ = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
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
