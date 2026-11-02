// posServiceAddOnsApi.ts — catalog-wide add-ons across all services (pos.services.view). Now includes full
// CRUD for add-ons: create, update, archive, reactivate. Add-ons are global catalog items that can be
// attached to any service line during booking/walk-in.
import { api } from "./client";

export interface AddOnCreateBody {
  name: string;
  priceCents: number;
  durationDeltaMinutes: number;
  isTaxable?: boolean;
  serviceIds?: string[];  // which services this add-on applies to; empty = all
}

export interface AddOnUpdateBody {
  name?: string;
  priceCents?: number;
  durationDeltaMinutes?: number;
  isTaxable?: boolean;
  serviceIds?: string[];
}

export const posServiceAddOnsApi = {
  state: () => api.get(`/pos/service-add-ons/state`),
  create: (body: AddOnCreateBody) => api.post(`/pos/service-add-ons`, body as unknown as Record<string, unknown>),
  update: (addOnId: string, body: AddOnUpdateBody) => api.patch(`/pos/service-add-ons/${addOnId}`, body as unknown as Record<string, unknown>),
  archive: (addOnId: string) => api.post(`/pos/service-add-ons/${addOnId}/archive`),
  reactivate: (addOnId: string) => api.post(`/pos/service-add-ons/${addOnId}/reactivate`),
};

