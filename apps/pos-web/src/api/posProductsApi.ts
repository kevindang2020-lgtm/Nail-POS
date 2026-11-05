// posProductsApi.ts — inventory Products catalog (reuses the existing inventory endpoints).
// view: inventory.view · create: inventory.create · archive: inventory.archive · add stock: inventory.stock.add
import { api } from "./client";
const enc = encodeURIComponent;
export const posProductsApi = {
  list: (search?: string) => api.get<any>(`/tenant/inventory/products`, search ? { search } : undefined),
  create: (body: Record<string, unknown>) => api.post(`/tenant/inventory/products`, body),
  archive: (id: string) => api.post(`/tenant/inventory/products/${enc(id)}/archive`),
  addStock: (id: string, body: Record<string, unknown>) => api.post(`/tenant/inventory/products/${enc(id)}/stock/add`, body),
  categories: () => api.get<any>(`/tenant/inventory/categories`),
  brands: () => api.get<any>(`/tenant/inventory/brands`),
};
