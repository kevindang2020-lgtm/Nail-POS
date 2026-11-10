// posSavedViewsApi.ts — POS saved views (extras arc, Nov 9 2026): the signed-in person's own named filters for one screen
// (pos/me/saved-views). Session-scoped server-side: no user or salon id is sent.
import { api } from './client';
import type { SavedView, SavedViewList, SavedViewFilters } from '@aipowersalon/api-contracts/tenant';
export type { SavedView, SavedViewList, SavedViewFilters };

export const posSavedViewsApi = {
  list: (surface: string) => api.get<SavedViewList>('/pos/me/saved-views', { surface }),
  create: (b: { surface: string; name: string; filters: SavedViewFilters; isDefault?: boolean }) => api.post<SavedView>('/pos/me/saved-views', b as unknown as Record<string, unknown>),
  update: (id: string, b: { name?: string; filters?: SavedViewFilters; isDefault?: boolean }) => api.patch<SavedView>(`/pos/me/saved-views/${encodeURIComponent(id)}`, b as Record<string, unknown>),
  remove: (id: string) => api.del<{ deleted: true }>(`/pos/me/saved-views/${encodeURIComponent(id)}`),
};
