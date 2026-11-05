// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { HwFilter } from '@aipowersalon/api-contracts/platform';
import type { HwFilter } from '@aipowersalon/api-contracts/platform';
// hardware-packages-core.ts — pure logic for the Super-Admin Hardware Packages page: legacy→canonical status
// normalization, KPI summary (8 cards with real MoM trends), status + package-type breakdowns, filtering/sorting/
// pagination, the status-transition state machine, and device derivation for legacy rows. No I/O; fully unit-tested.

export const PACKAGE_STATUSES = ['not_ordered', 'ready_to_ship', 'ordered', 'processing', 'shipped', 'delivered', 'installed', 'complete', 'cancelled', 'returned'] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];
export const PAYMENT_STATUSES = ['unpaid', 'pending', 'deposit_paid', 'financing', 'partially_paid', 'paid', 'paid_off', 'refunded'] as const;
export const CARRIERS = ['fedex', 'ups', 'usps', 'dhl', 'other'] as const;
export const PACKAGE_TYPES = ['pro_plus', 'pro', 'standard'] as const;

const LEGACY: Record<string, PackageStatus> = { not_started: 'not_ordered', pending_approval: 'not_ordered', ready: 'ready_to_ship', activated: 'complete', on_hold: 'processing' };
export function normalizeStatus(s: string | null | undefined): PackageStatus {
  if (!s) return 'not_ordered';
  if ((PACKAGE_STATUSES as readonly string[]).includes(s)) return s as PackageStatus;
  return LEGACY[s] ?? 'not_ordered';
}

export interface DeviceRow { id?: string; deviceType: string; deviceName: string; serialNumber: string | null; assetTag: string | null; quantity: number; status?: string }
export interface PkgRow {
  id: string; tenantId: string | null; salonName: string | null; salonCode: string | null; ownerName: string | null; city: string | null; state: string | null;
  packageName: string | null; packageType: string | null; status: string; paymentStatus: string;
  hardwareCostCents: number | null; depositCents: number | null; amountPaidCents: number | null; financingTerms: string | null;
  shippingAddress: string | null; shippingCity: string | null; shippingState: string | null; shippingZip: string | null;
  shippingCarrier: string | null; trackingNumber: string | null; trackingUrl: string | null;
  imacColor: string | null; imacSerial: string | null; cloverFlexSerial: string | null; checkinDisplaySerial: string | null;
  orderedAt: string | null; shippedAt: string | null; deliveredAt: string | null; installedAt: string | null; completedAt: string | null; cancelledAt: string | null; returnedAt: string | null;
  deviceCount?: number; createdAt: string; updatedAt: string;
}

// ---- month helpers for MoM trends ----
const ym = (iso: string) => { const d = new Date(iso); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const months = (now: Date) => { const cur = now.getUTCFullYear() * 12 + now.getUTCMonth(); return { cur, prev: cur - 1 }; };
const pctDelta = (c: number, p: number) => (p === 0 ? (c === 0 ? 0 : 100) : Math.round(((c - p) / p) * 1000) / 10);

const PENDING_PAY = new Set(['unpaid', 'pending', 'deposit_paid', 'financing', 'partially_paid']);
const PAID = new Set(['paid', 'paid_off']);

export interface HwSummary {
  totalPackages: number; notOrdered: number; readyToShip: number; shipped: number; delivered: number; installedComplete: number; pendingPayment: number; paidOff: number;
  trends: Record<string, number>;
}
export function computeSummary(rows: PkgRow[], now: Date = new Date()): HwSummary {
  const st = (r: PkgRow) => normalizeStatus(r.status);
  const count = (pred: (r: PkgRow) => boolean) => rows.filter(pred).length;
  const { cur, prev } = months(now);
  const mom = (pred: (r: PkgRow) => boolean) => pctDelta(rows.filter((r) => ym(r.createdAt) === cur && pred(r)).length, rows.filter((r) => ym(r.createdAt) === prev && pred(r)).length);
  const buckets: [string, (r: PkgRow) => boolean][] = [
    ['totalPackages', () => true], ['notOrdered', (r) => st(r) === 'not_ordered'], ['readyToShip', (r) => st(r) === 'ready_to_ship'],
    ['shipped', (r) => st(r) === 'shipped'], ['delivered', (r) => st(r) === 'delivered'], ['installedComplete', (r) => st(r) === 'installed' || st(r) === 'complete'],
    ['pendingPayment', (r) => PENDING_PAY.has(r.paymentStatus)], ['paidOff', (r) => PAID.has(r.paymentStatus)],
  ];
  const out: any = { trends: {} };
  for (const [k, pred] of buckets) { out[k] = count(pred); out.trends[k] = mom(pred); }
  return out as HwSummary;
}

export function statusBreakdown(rows: PkgRow[]): { status: string; count: number; pct: number }[] {
  const total = rows.length || 1;
  const groups: [string, (s: PackageStatus) => boolean][] = [
    ['not_ordered', (s) => s === 'not_ordered'], ['ready_to_ship', (s) => s === 'ready_to_ship'], ['shipped', (s) => s === 'shipped'],
    ['delivered', (s) => s === 'delivered'], ['installed_complete', (s) => s === 'installed' || s === 'complete'],
  ];
  return groups.map(([status, pred]) => { const count = rows.filter((r) => pred(normalizeStatus(r.status))).length; return { status, count, pct: Math.round((count / total) * 1000) / 10 }; });
}

export function packageTypeBreakdown(rows: PkgRow[]): { type: string; count: number; pct: number }[] {
  const total = rows.length || 1;
  const m = new Map<string, number>();
  for (const r of rows) { const k = r.packageType || 'standard'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([type, count]) => ({ type, count, pct: Math.round((count / total) * 1000) / 10 })).sort((a, b) => b.count - a.count);
}

export function filterPackages(rows: PkgRow[], f: HwFilter): PkgRow[] {
  const q = (f.search ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.tenantId && r.tenantId !== f.tenantId) return false;
    if (f.status && f.status !== 'all' && normalizeStatus(r.status) !== f.status) return false;
    if (f.paymentStatus && f.paymentStatus !== 'all' && r.paymentStatus !== f.paymentStatus) return false;
    if (f.packageType && f.packageType !== 'all' && (r.packageType || 'standard') !== f.packageType) return false;
    if (f.carrier && f.carrier !== 'all' && (r.shippingCarrier || '').toLowerCase() !== f.carrier) return false;
    if (f.dateFrom || f.dateTo) {
      const d = r.createdAt.slice(0, 10);
      if (f.dateFrom && d < f.dateFrom.slice(0, 10)) return false;
      if (f.dateTo && d > f.dateTo.slice(0, 10)) return false;
    }
    if (q) { const hay = [r.salonName, r.ownerName, r.packageName, r.salonCode].filter(Boolean).join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  });
}

export function sortPackages(rows: PkgRow[], sortBy = 'updatedAt', dir: 'asc' | 'desc' = 'desc'): PkgRow[] {
  const key = (['updatedAt', 'createdAt', 'salonName', 'status', 'paymentStatus'] as const).includes(sortBy as any) ? sortBy : 'updatedAt';
  const out = [...rows].sort((a: any, b: any) => { const av = a[key] ?? '', bv = b[key] ?? ''; return av < bv ? -1 : av > bv ? 1 : 0; });
  return dir === 'desc' ? out.reverse() : out;
}

export function paginate<T>(rows: T[], page = 1, limit = 10) {
  const totalItems = rows.length; const totalPages = Math.max(1, Math.ceil(totalItems / limit)); const p = Math.min(Math.max(1, page), totalPages);
  return { items: rows.slice((p - 1) * limit, (p - 1) * limit + limit), pagination: { page: p, limit, totalItems, totalPages } };
}

// ---- status transition state machine (spec §18) ----
const TRANSITIONS: Record<PackageStatus, PackageStatus[]> = {
  not_ordered: ['ordered', 'ready_to_ship', 'cancelled'], ready_to_ship: ['shipped', 'cancelled'], ordered: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'], shipped: ['delivered', 'returned'], delivered: ['installed', 'returned'], installed: ['complete'],
  complete: ['returned'], cancelled: [], returned: [],
};
export function canTransition(from: string, to: string, force = false): boolean {
  if (force) return (PACKAGE_STATUSES as readonly string[]).includes(to);
  const f = normalizeStatus(from); if (!(PACKAGE_STATUSES as readonly string[]).includes(to)) return false;
  if (f === to) return false;
  return (TRANSITIONS[f] ?? []).includes(to as PackageStatus);
}

/** Devices: explicit rows if present, else derive the standard kit from the package type + legacy serial columns. */
export function devicesFor(pkg: PkgRow, rows: DeviceRow[]): DeviceRow[] {
  if (rows.length) return rows;
  const out: DeviceRow[] = [
    { deviceType: 'imac', deviceName: '24" iMac (M4)', serialNumber: pkg.imacSerial, assetTag: null, quantity: 1 },
    { deviceType: 'clover_flex', deviceName: 'Clover Flex Card Reader', serialNumber: pkg.cloverFlexSerial, assetTag: null, quantity: 1 },
  ];
  const t = pkg.packageType || 'standard';
  if (t === 'pro' || t === 'pro_plus') out.push({ deviceType: 'checkin_display', deviceName: 'Customer Check-In Display', serialNumber: pkg.checkinDisplaySerial, assetTag: null, quantity: 1 });
  if (t === 'pro_plus') out.push({ deviceType: 'printer', deviceName: 'Receipt Printer', serialNumber: null, assetTag: null, quantity: 1 });
  return out;
}
export const deviceCountFor = (pkg: PkgRow, rows: DeviceRow[]): number => devicesFor(pkg, rows).reduce((n, d) => n + (d.quantity || 1), 0);
