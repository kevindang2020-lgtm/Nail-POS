// posPurchaseOrdersApi.ts — Purchase Orders (reuses the fully-built inventory PO backend, migration 117).
// view: inventory.purchase_order.view · create/cancel: .create · approve: .approve · receive: .receive
import { api } from "./client";
const enc = encodeURIComponent;
export const posPurchaseOrdersApi = {
  list: (status?: string) => api.get<any>(`/tenant/inventory/purchase-orders`, status ? { status } : undefined),
  get: (id: string) => api.get<any>(`/tenant/inventory/purchase-orders/${enc(id)}`),
  create: (body: Record<string, unknown>) => api.post(`/tenant/inventory/purchase-orders`, body),
  approve: (id: string) => api.post(`/tenant/inventory/purchase-orders/${enc(id)}/approve`),
  receive: (id: string, lines: { lineId: string; quantity: number }[]) => api.post(`/tenant/inventory/purchase-orders/${enc(id)}/receive`, { lines }),
  cancel: (id: string, note?: string) => api.post(`/tenant/inventory/purchase-orders/${enc(id)}/cancel`, { note }),
  vendors: () => api.get<any>(`/tenant/inventory/vendors`),
  products: () => api.get<any>(`/tenant/inventory/products`),
};
