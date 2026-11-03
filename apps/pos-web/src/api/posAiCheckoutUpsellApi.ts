// posAiCheckoutUpsellApi.ts — typed client for the AI Checkout Upsell endpoints. Read = context/recommendations;
// every mutation carries { confirm:true, idempotencyKey } and returns authoritative totals from the server. The client
// never sends a price — the server prices everything.
import { api } from './client';

const enc = encodeURIComponent;
type Q = Record<string, string | number | undefined>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
const idem = () => (globalThis.crypto?.randomUUID?.() ?? `k_${Date.now()}_${Math.random().toString(36).slice(2)}`);

export const posAiCheckoutUpsellApi = {
  context: (checkoutId: string) => api.get<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/context`),
  recommendations: (checkoutId: string) => api.get<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/recommendations`),
  settings: () => api.get<any>(`/pos/ai-checkout-upsell/settings`),
  /** Checkout Upsell Settings guide (Nov 2026): send ONLY the changed key(s) + the version the editor read; the server merges
   *  into the salon's row (a 409 means someone else saved first — reload) and records before → after in the history */
  updateSettings: (level: 'tenant' | 'branch' | 'device' | 'user', patch: { enabled?: boolean; tunables?: any; expectedVersion?: number | null }) => api.put<any>(`/pos/ai-checkout-upsell/settings/${level}`, patch),
  // the settings page's read side: status row · Suggestion Activity · Settings History · Check Checkout Upsell System
  center: {
    summary: () => api.get<any>(`/pos/ai-checkout-upsell/center/summary`),
    activity: (q: Q = {}) => api.get<any>(`/pos/ai-checkout-upsell/center/activity`, clean(q)),
    history: (q: Q = {}) => api.get<any>(`/pos/ai-checkout-upsell/center/history`, clean(q)),
    check: () => api.post<any>(`/pos/ai-checkout-upsell/center/check`, {}),
  },

  addAddon: (checkoutId: string, addOnId: string) =>
    api.post<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/addons/${enc(addOnId)}/add`, { confirm: true, idempotencyKey: idem() }),
  enrollMembership: (checkoutId: string, planId: string) =>
    api.post<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/membership/${enc(planId)}/enroll`, { confirm: true, idempotencyKey: idem() }),
  redeemLoyalty: (checkoutId: string, rewardId: string) =>
    api.post<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/loyalty/${enc(rewardId)}/redeem`, { confirm: true, idempotencyKey: idem() }),
  applyPromotion: (checkoutId: string, promotionId: string) =>
    api.post<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/promotions/${enc(promotionId)}/apply`, { confirm: true, idempotencyKey: idem() }),
  nextAppointment: (checkoutId: string, serviceId: string) =>
    api.post<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/next-appointment/${enc(serviceId)}`, { confirm: true, idempotencyKey: idem() }),

  dismiss: (checkoutId: string, targetId: string, reason: string) =>
    api.post<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/dismiss`, { targetId, reason }),
  feedback: (checkoutId: string, recommendationId: string, rating: string, reason = '') =>
    api.post<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/feedback`, { recommendationId, rating, reason }),
};
