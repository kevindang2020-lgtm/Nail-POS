// posSalonPromotionsApi.ts — tenant salon promotions / coupons. Permission-gated server-side
// (pos.marketing.view for reads, pos.marketing.manage for writes). Distinct from platform promotions.
import { api } from "./client";
export const posSalonPromotionsApi = {
  state: () => api.get(`/pos/salon-promotions/state`),
  create: (body: Record<string, unknown>) => api.post(`/pos/salon-promotions`, body),
  setStatus: (id: string, status: string) => api.post(`/pos/salon-promotions/${id}/status`, { status }),
  redeem: (code: string, subtotalCents: number) => api.post(`/pos/salon-promotions/redeem`, { code, subtotalCents }),
};
