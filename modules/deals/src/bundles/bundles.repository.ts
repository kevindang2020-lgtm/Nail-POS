// bundles.repository.ts — persistence port + in-memory adapter for POS Bundles.
// A tenant-scoped, MUTABLE store so create/edit/archive genuinely persist within a session. Only the seeded demo
// tenant (luxe001) has rows; every other tenant sees its own (empty) catalog — isolation by construction. Derived
// fields (component total, savings, savings%, live-now) are computed via bundles-core so both adapters agree.
import {
  BundlesState, BundleRow, BundleDetail, BundleItem, BundleFilters, CreateBundleRequest, UpdateBundleRequest,
  componentsTotalCents, savingsCents, savingsPct, isActiveNow, summarize,
} from './bundles.dto';
import type { BundleKind, BundleStatus, BundleSummaryRow } from './bundles-core';

export interface BundlesContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface Stored {
  bundleId: string; name: string; kind: BundleKind; label: string | null; priceCents: number; status: BundleStatus;
  onlineBookingEnabled: boolean; startsAt: string | null; endsAt: string | null; usageLimit: number | null;
  metricNote: string | null; createdAt: string; updatedAt: string; items: BundleItem[];
}

export interface BundlesRepositoryPort {
  query(ctx: BundlesContext, f: BundleFilters): Promise<BundlesState>;
  detail(ctx: BundlesContext, bundleId: string): Promise<BundleDetail | null>;
  create(ctx: BundlesContext, req: CreateBundleRequest): Promise<BundleDetail>;
  update(ctx: BundlesContext, bundleId: string, req: UpdateBundleRequest): Promise<BundleDetail | null>;
  setStatus(ctx: BundlesContext, bundleId: string, status: BundleStatus): Promise<BundleRow | null>;
}

const now = () => new Date().toISOString();

export function toRow(b: Stored, nowIso: string): BundleRow {
  const ct = componentsTotalCents(b.items);
  return {
    bundleId: b.bundleId, name: b.name, kind: b.kind, label: b.label, priceCents: b.priceCents,
    componentsTotalCents: ct, savingsCents: savingsCents(ct, b.priceCents), savingsPct: savingsPct(ct, b.priceCents),
    status: b.status, itemCount: b.items.length, onlineBookingEnabled: b.onlineBookingEnabled,
    startsAt: b.startsAt, endsAt: b.endsAt, usageLimit: b.usageLimit, metricNote: b.metricNote,
    isLiveNow: isActiveNow(b.status, b.startsAt, b.endsAt, nowIso),
    createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}
export function toDetail(b: Stored, nowIso: string): BundleDetail { return { ...toRow(b, nowIso), items: b.items.slice() }; }

function matches(b: Stored, f: BundleFilters): boolean {
  if (f.status && b.status !== f.status) return false;
  if (f.kind && b.kind !== f.kind) return false;
  if (f.onlineOnly && !b.onlineBookingEnabled) return false;
  if (f.search) { const q = f.search.toLowerCase(); if (!b.name.toLowerCase().includes(q) && !(b.label || '').toLowerCase().includes(q)) return false; }
  return true;
}

export class InMemoryBundlesRepository implements BundlesRepositoryPort {
  private store = new Map<string, Stored[]>();
  private seq = 5000;

  private id(prefix: string): string { return `${prefix}_${++this.seq}`; }

  private ensure(tenantId: string): Stored[] {
    const existing = this.store.get(tenantId);
    if (existing) return existing;
    const rows: Stored[] = tenantId === 'luxe001' ? this.seed() : [];
    this.store.set(tenantId, rows);
    return rows;
  }

  private item(type: 'service' | 'product', label: string, qty: number, unit: number, sort: number): BundleItem {
    return { itemId: this.id('bi'), itemType: type, refId: null, label, quantity: qty, unitPriceCents: unit, sortOrder: sort };
  }

  // Illustrative demo catalog for luxe001 only (matches the reference card). Component snapshots are chosen so the
  // DERIVED savings equal the reference's displayed savings; production (Kysely) reads the real, initially-empty table.
  private seed(): Stored[] {
    const t = now();
    const mk = (name: string, kind: BundleKind, label: string | null, price: number, items: BundleItem[], extra: Partial<Stored> = {}): Stored => ({
      bundleId: this.id('bndl'), name, kind, label, priceCents: price, status: 'active', onlineBookingEnabled: true,
      startsAt: null, endsAt: null, usageLimit: null, metricNote: null, createdAt: t, updatedAt: t, items, ...extra,
    });
    return [
      mk('Gel Mani + Spa Pedi', 'bundle', 'Best Seller', 9200, [this.item('service', 'Gel Manicure', 1, 4500, 0), this.item('service', 'Spa Pedicure', 1, 5500, 1)]),
      mk('VIP Maintenance Bundle', 'package', 'Popular', 14900, [this.item('service', 'Gel X Full Set', 1, 6000, 0), this.item('service', 'Spa Pedicure', 2, 5500, 1)]),
      mk('Seasonal Spring Glow Kit', 'promo', 'Seasonal', 4900, [this.item('service', 'Spa Pedicure', 1, 4500, 0), this.item('product', 'Spring Polish Duo', 1, 1400, 1)]),
      mk('Loyalty Plus (Add-on)', 'membership', 'Membership', 1900, [this.item('service', 'Priority Booking Perk', 1, 1900, 0)], { metricNote: 'Repeat rate: 82%' }),
      mk('Student Discount Combo', 'promo', 'Promo', 7500, [this.item('service', 'Gel Manicure', 1, 4500, 0), this.item('service', 'Eyebrow Wax', 1, 1800, 1), this.item('service', 'French Tips', 1, 1900, 2)]),
    ];
  }

  async query(ctx: BundlesContext, f: BundleFilters = {}): Promise<BundlesState> {
    const all = this.ensure(ctx.tenantId);
    const nowIso = now();
    const visible = all.filter((b) => b.status !== 'archived');
    const filtered = visible.filter((b) => matches(b, f));
    const rows = filtered.map((b) => toRow(b, nowIso)).sort((a, b) => b.savingsCents - a.savingsCents || a.name.localeCompare(b.name));
    const summaryRows: BundleSummaryRow[] = visible.map((b) => ({ kind: b.kind, status: b.status, priceCents: b.priceCents, componentsTotalCents: componentsTotalCents(b.items), startsAt: b.startsAt, endsAt: b.endsAt }));
    return { kpis: summarize(summaryRows, nowIso), rows };
  }

  async detail(ctx: BundlesContext, bundleId: string): Promise<BundleDetail | null> {
    const b = this.ensure(ctx.tenantId).find((x) => x.bundleId === bundleId);
    return b ? toDetail(b, now()) : null;
  }

  private buildItems(items: CreateBundleRequest['items']): BundleItem[] {
    return (items || []).map((it, i) => ({
      itemId: this.id('bi'), itemType: it.itemType, refId: it.refId ?? null, label: it.label,
      quantity: Math.max(1, Math.floor(Number(it.quantity) || 0)), unitPriceCents: Math.max(0, Math.round(Number(it.unitPriceCents) || 0)), sortOrder: i,
    }));
  }

  async create(ctx: BundlesContext, req: CreateBundleRequest): Promise<BundleDetail> {
    const list = this.ensure(ctx.tenantId);
    const t = now();
    const b: Stored = {
      bundleId: this.id('bndl'), name: req.name.trim(), kind: req.kind, label: req.label ?? null, priceCents: Math.max(0, Math.round(req.priceCents)),
      status: req.status ?? 'active', onlineBookingEnabled: req.onlineBookingEnabled ?? true, startsAt: req.startsAt ?? null, endsAt: req.endsAt ?? null,
      usageLimit: req.usageLimit ?? null, metricNote: req.metricNote ?? null, createdAt: t, updatedAt: t, items: this.buildItems(req.items),
    };
    list.push(b);
    return toDetail(b, t);
  }

  async update(ctx: BundlesContext, bundleId: string, req: UpdateBundleRequest): Promise<BundleDetail | null> {
    const b = this.ensure(ctx.tenantId).find((x) => x.bundleId === bundleId);
    if (!b) return null;
    if (req.name !== undefined) b.name = req.name.trim();
    if (req.kind !== undefined) b.kind = req.kind;
    if (req.label !== undefined) b.label = req.label;
    if (req.priceCents !== undefined) b.priceCents = Math.max(0, Math.round(req.priceCents));
    if (req.status !== undefined) b.status = req.status;
    if (req.onlineBookingEnabled !== undefined) b.onlineBookingEnabled = req.onlineBookingEnabled;
    if (req.startsAt !== undefined) b.startsAt = req.startsAt;
    if (req.endsAt !== undefined) b.endsAt = req.endsAt;
    if (req.usageLimit !== undefined) b.usageLimit = req.usageLimit;
    if (req.metricNote !== undefined) b.metricNote = req.metricNote;
    if (req.items !== undefined) b.items = this.buildItems(req.items);
    b.updatedAt = now();
    return toDetail(b, b.updatedAt);
  }

  async setStatus(ctx: BundlesContext, bundleId: string, status: BundleStatus): Promise<BundleRow | null> {
    const b = this.ensure(ctx.tenantId).find((x) => x.bundleId === bundleId);
    if (!b) return null;
    b.status = status; b.updatedAt = now();
    return toRow(b, b.updatedAt);
  }
}
