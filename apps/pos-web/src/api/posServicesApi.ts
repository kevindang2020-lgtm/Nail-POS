// posServicesApi.ts — POS Services client, reconciled to the real backend routes (see api contract audit).
import { api } from "./client";
export const posServicesApi = {
  state: (q?: Record<string, unknown>) => api.get(`/pos/services/state`, q),
  categories: () => api.get(`/pos/services/categories`),
  list: () => api.get(`/pos/services`),
  create: (body: Record<string, unknown>) => api.post(`/pos/services`, body),
  update: (id: string, body: Record<string, unknown>) => api.patch(`/pos/services/${id}`, body),
  archive: (id: string) => api.post(`/pos/services/${id}/archive`),
  reactivate: (id: string) => api.post(`/pos/services/${id}/reactivate`),
  // categories — backend: @Get/@Post '/pos/services/categories', @Patch/@Post 'categories/:categoryId[/archive]'
  createCategory: (body: Record<string, unknown>) => api.post(`/pos/services/categories`, body),
  updateCategory: (categoryId: string, body: Record<string, unknown>) => api.patch(`/pos/services/categories/${categoryId}`, body),
  archiveCategory: (categoryId: string, confirm = true) => api.post(`/pos/services/categories/${categoryId}/archive`, { confirm }),
  // Export Data — the async export flow (@AsyncExport pos.services.export); resolves to { filename, csv }
  exportCsv: (q: Record<string, unknown> = {}) => api.exportAsync<any>(`/pos/services/export`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''))),
  importPreview: (csv: string) => api.post(`/pos/services/import/preview`, { csv }),
  importCommit: (csv: string) => api.post(`/pos/services/import/commit`, { csv }),
};
