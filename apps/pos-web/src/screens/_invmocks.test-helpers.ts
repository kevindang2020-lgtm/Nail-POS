// _invmocks.test-helpers.ts — shared mocks for the Inventory / Products / Suppliers screen tests (Oct 29 2026 rebuilds):
// every list is an empty first page, the metrics a zero salon unless a test overrides them. Not a test file itself.
import { vi } from 'vitest';
export const PERIOD = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' };
export const emptyPage = () => ({ period: PERIOD, rows: [], items: [], total: 0, totalItems: 0, page: 1, pageSize: 10, pages: 1, totalPages: 1, categories: [], brands: [], vendors: [], counts: {} });
export const METRICS = { products: 0, bottles: 0, bottlesByUnit: [], open: 0, unopened: 0, lowStock: 0, critical: 0, outOfStock: 0, expiringSoon: 0, expiryHorizonDays: 30, expired: 0, pendingReports: 0, inventoryValueCents: null, productsWithoutCost: 0, needReorder: 0, retailValueCents: null, drift: 0, asOf: '2026-10-29T12:00:00Z' };
/** An API object whose every method resolves an empty page — unless `over` names it. */
export const anyApi = (over: Record<string, (...a: any[]) => any> = {}) => new Proxy({} as Record<string, any>, {
  get: (t, k: string) => (t[k] ??= over[k] ? vi.fn(over[k]) : vi.fn(async () => emptyPage())),
});
