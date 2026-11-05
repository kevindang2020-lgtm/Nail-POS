// bundles.dto.ts — request/response contracts for the POS Bundles / Packages / Membership Add-ons surface.
// Re-exports the pure helpers from bundles-core so the in-memory and Kysely repositories share the SAME math.
export {
  componentsTotalCents, savingsCents, savingsPct, isActiveNow, isValidWindow, summarize,
  isBundleKind, isBundleStatus, isBundleItemType, BUNDLE_KINDS, BUNDLE_STATUSES, BUNDLE_ITEM_TYPES,
} from './bundles-core';
export type { BundleKind, BundleStatus, BundleItemType, BundleKpis, BundleSummaryRow } from './bundles-core';

import type { BundleKind, BundleStatus, BundleItemType, BundleKpis } from './bundles-core';

export interface BundleItem {
  itemId: string;
  itemType: BundleItemType;
  refId: string | null;        // service_id or product_id when known; null for a free-text component
  label: string;               // name snapshot, shown in the detail card without a join
  quantity: number;
  unitPriceCents: number;      // regular-price snapshot captured when the item was added
  sortOrder: number;
}

export interface BundleRow {
  bundleId: string;
  name: string;
  kind: BundleKind;
  label: string | null;        // display badge: 'Best Seller' | 'Popular' | 'Seasonal' | 'Membership' | 'Promo' | …
  priceCents: number;
  componentsTotalCents: number;
  savingsCents: number;
  savingsPct: number;
  status: BundleStatus;
  itemCount: number;
  onlineBookingEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  metricNote: string | null;   // optional manager annotation (e.g. membership perk note); null → UI shows savings
  isLiveNow: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BundleDetail extends BundleRow { items: BundleItem[]; }

export interface BundlesState { kpis: BundleKpis; rows: BundleRow[]; }

export interface BundleFilters { search?: string; kind?: string; status?: string; onlineOnly?: boolean; }

export interface CreateBundleItemInput { itemType: BundleItemType; refId?: string | null; label: string; quantity: number; unitPriceCents: number; }
export interface CreateBundleRequest {
  name: string;
  kind: BundleKind;
  label?: string | null;
  priceCents: number;
  status?: BundleStatus;
  onlineBookingEnabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  metricNote?: string | null;
  items: CreateBundleItemInput[];
}
export interface UpdateBundleRequest {
  name?: string;
  kind?: BundleKind;
  label?: string | null;
  priceCents?: number;
  status?: BundleStatus;
  onlineBookingEnabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  metricNote?: string | null;
  items?: CreateBundleItemInput[];   // when present, replaces the item set wholesale
}

export interface ArchiveBundleResult { ok: boolean; bundleId: string; status: BundleStatus; }
