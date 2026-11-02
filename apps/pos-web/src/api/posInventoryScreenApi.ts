// posInventoryScreenApi.ts — Inventory / Products / Suppliers mandates (Oct 29 2026): the read models behind POS Inventory
// (/tenant/inventory/screen/*, all eight tabs), Products (/tenant/products) and Suppliers (/tenant/inventory/suppliers/*).
// Lists page on the server (newest first) with one search box and a period that names its date field; the metrics are
// "now" and never change with a period. Writes reuse the existing inventory routes (inventoryApi) plus the supplier
// contacts / product links / restore routes here.
import { api } from './client';
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const enc = encodeURIComponent;
const S = '/tenant/inventory/screen';
const V = '/tenant/inventory/suppliers';
export const posInventoryScreenApi = {
  metrics: () => api.get<any>(`${S}/metrics`),
  products: (q: Q) => api.get<any>(`${S}/products`, clean(q)),
  product: (id: string) => api.get<any>(`${S}/products/${enc(id)}`),
  restoreProduct: (id: string) => api.post<any>(`${S}/products/${enc(id)}/restore`, {}),
  recountProduct: (id: string) => api.post<any>(`${S}/products/${enc(id)}/recount`, {}),
  exportProducts: (q: Q) => api.exportAsync<string>(`${S}/products/export`, clean(q), 'text'),
  movements: (q: Q) => api.get<any>(`${S}/movements`, clean(q)),
  purchaseOrders: (q: Q) => api.get<any>(`${S}/purchase-orders`, clean(q)),
  purchaseOrder: (id: string) => api.get<any>(`${S}/purchase-orders/${enc(id)}`),
  transfers: (q: Q) => api.get<any>(`${S}/transfers`, clean(q)),
  counts: (q: Q) => api.get<any>(`${S}/counts`, clean(q)),
  catalog: (q: Q) => api.get<any>(`${S}/catalog`, clean(q)),
  recipes: (q: Q) => api.get<any>(`${S}/recipes`, clean(q)),
  reports: (q: Q) => api.get<any>(`${S}/reports`, clean(q)),
};
export const posSuppliersApi = {
  kpis: () => api.get<any>(`${V}/kpis`),
  directory: (q: Q) => api.get<any>(`${V}/directory`, clean(q)),
  supplier: (id: string) => api.get<any>(`${V}/${enc(id)}`),
  products: (id: string, q: Q) => api.get<any>(`${V}/${enc(id)}/products`, clean(q)),
  receiving: (id: string, q: Q) => api.get<any>(`${V}/${enc(id)}/receiving`, clean(q)),
  purchaseOrders: (id: string, q: Q) => api.get<any>(`${V}/${enc(id)}/purchase-orders`, clean(q)),
  restore: (id: string) => api.post<any>(`${V}/${enc(id)}/restore`, {}),
  addContact: (id: string, b: Q) => api.post<any>(`${V}/${enc(id)}/contacts`, b),
  editContact: (id: string, cid: string, b: Q) => api.patch<any>(`${V}/${enc(id)}/contacts/${enc(cid)}`, b),
  deactivateContact: (id: string, cid: string) => api.post<any>(`${V}/${enc(id)}/contacts/${enc(cid)}/deactivate`, {}),
  linkProduct: (id: string, b: Q) => api.post<any>(`${V}/${enc(id)}/products`, b),
  unlinkProduct: (id: string, pid: string) => api.post<any>(`${V}/${enc(id)}/products/${enc(pid)}/unlink`, {}),
  linkPurchaseOrder: (poId: string, vendorId: string) => api.post<any>(`${V}/purchase-orders/${enc(poId)}/vendor`, { vendorId }),
};
