// posAiCheckoutUpsellApi.ts — typed client for the AI Checkout Upsell endpoints. Read = context/recommendations;
// every mutation carries { confirm:true, idempotencyKey } and returns authoritative totals from the server. The client
// never sends a price — the server prices everything.
import { api } from './client';

const enc = encodeURIComponent;
const idem = () => (globalThis.crypto?.randomUUID?.() ?? `k_${Date.now()}_${Math.random().toString(36).slice(2)}`);

export const posAiCheckoutUpsellApi = {
  context: (checkoutId: string) => api.get<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/context`),
  recommendations: (checkoutId: string) => api.get<any>(`/pos/ai-checkout-upsell/checkout/${enc(checkoutId)}/recommendations`),
  settings: () => api.get<any>(`/pos/ai-checkout-upsell/settings`),
  updateSettings: (level: 'tenant' | 'branch' | 'device' | 'user', patch: { enabled?: boolean; tunables?: any }) => api.put<any>(`/pos/ai-checkout-upsell/settings/${level}`, patch),

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
