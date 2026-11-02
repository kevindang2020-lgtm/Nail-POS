// bundles.kysely.repository.ts — production BundlesRepositoryPort over Postgres.
// Reads use typed Kysely selects (resilient with .catch); writes use parameterized sql`` (Kysely escapes every
// ${param}). SCOPE is session-derived (tenant_id + branch_id, branch-or-null), never the client. Derived fields
// (component total, savings, savings%, live-now, KPIs) reuse the SAME bundles-core helpers as the in-memory repo.
import { canMoveToSql } from '@aipowersalon/database';
import { foldVi } from '@aipowersalon/api-contracts';
import { BUNDLE } from '../engine/deal-lifecycles';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { BundlesContext, BundlesRepositoryPort, Stored } from './bundles.repository';
import { toRow, toDetail } from './bundles.repository';
import {
  BundlesState, BundleRow, BundleDetail, BundleItem, BundleFilters, CreateBundleRequest, UpdateBundleRequest,
  componentsTotalCents, summarize,
} from './bundles.dto';
import type { BundleKind, BundleStatus, BundleItemType, BundleSummaryRow } from './bundles-core';

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const isoN = (v: any): string | null => (v == null ? null : iso(v));

export class KyselyBundlesRepository implements BundlesRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  private scoped(qb: any, ctx: BundlesContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }

  private async loadItems(ctx: BundlesContext, bundleIds: string[]): Promise<Map<string, BundleItem[]>> {
    const map = new Map<string, BundleItem[]>();
    if (!bundleIds.length) return map;
    const rows = await this.db.selectFrom('bundle_items')
      .where('tenant_id', '=', ctx.tenantId).where('bundle_id', 'in', bundleIds)
      .select(['id', 'bundle_id', 'item_type', 'ref_id', 'label', 'quantity', 'unit_price_cents', 'sort_order'])
      .orderBy('sort_order').execute().catch(() => [] as any[]);
    for (const r of rows) {
      const it: BundleItem = { itemId: r.id, itemType: r.item_type as BundleItemType, refId: r.ref_id ?? null, label: r.label || '', quantity: Number(r.quantity) || 0, unitPriceCents: Number(r.unit_price_cents) || 0, sortOrder: Number(r.sort_order) || 0 };
      const arr = map.get(r.bundle_id) || []; arr.push(it); map.set(r.bundle_id, arr);
    }
    return map;
  }

  private async load(ctx: BundlesContext, bundleId?: string): Promise<Stored[]> {
    let qb = this.scoped(this.db.selectFrom('bundles'), ctx).where('archived_at', 'is', null);
    if (bundleId) qb = qb.where('id', '=', bundleId);
    const rows = await qb.select([
      'id', 'name', 'kind', 'label', 'price_cents', 'status', 'online_booking_enabled',
      'starts_at', 'ends_at', 'usage_limit', 'metric_note', 'created_at', 'updated_at',
    ]).orderBy('created_at').execute().catch(() => [] as any[]);
    const items = await this.loadItems(ctx, (rows as any[]).map((r) => r.id));
    return (rows as any[]).map((r): Stored => ({
      bundleId: r.id, name: r.name, kind: r.kind as BundleKind, label: r.label ?? null, priceCents: Number(r.price_cents) || 0,
      status: r.status as BundleStatus, onlineBookingEnabled: !!r.online_booking_enabled, startsAt: isoN(r.starts_at), endsAt: isoN(r.ends_at),
      usageLimit: r.usage_limit == null ? null : Number(r.usage_limit), metricNote: r.metric_note ?? null,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), items: items.get(r.id) || [],
    }));
  }

  async query(ctx: BundlesContext, f: BundleFilters = {}): Promise<BundlesState> {
    const nowIso = new Date().toISOString();
    const all = await this.load(ctx);
    const filtered = all.filter((b) => {
      if (f.status && b.status !== f.status) return false;
      if (f.kind && b.kind !== f.kind) return false;
      if (f.onlineOnly && !b.onlineBookingEnabled) return false;
      if (f.search) { const q = foldVi(f.search); if (!foldVi(b.name).includes(q) && !foldVi(b.label).includes(q)) return false; }   // accent-insensitive (§41)
      return true;
    });
    const rows = filtered.map((b) => toRow(b, nowIso)).sort((a, b) => b.savingsCents - a.savingsCents || a.name.localeCompare(b.name));
    const summaryRows: BundleSummaryRow[] = all.map((b) => ({ kind: b.kind, status: b.status, priceCents: b.priceCents, componentsTotalCents: componentsTotalCents(b.items), startsAt: b.startsAt, endsAt: b.endsAt }));
    return { kpis: summarize(summaryRows, nowIso), rows };
  }

  async detail(ctx: BundlesContext, bundleId: string): Promise<BundleDetail | null> {
    const [b] = await this.load(ctx, bundleId);
    return b ? toDetail(b, new Date().toISOString()) : null;
  }

  private async insertItems(ctx: BundlesContext, bundleId: string, items: CreateBundleRequest['items']) {
    let sort = 0;
    for (const it of items || []) {
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 0));
      const unit = Math.max(0, Math.round(Number(it.unitPriceCents) || 0));
      await sql`INSERT INTO bundle_items (tenant_id, bundle_id, item_type, ref_id, label, quantity, unit_price_cents, sort_order)
        VALUES (${ctx.tenantId}, ${bundleId}, ${it.itemType}, ${it.refId ?? null}, ${it.label}, ${qty}, ${unit}, ${sort++})`.execute(this.db);
    }
  }

  async create(ctx: BundlesContext, req: CreateBundleRequest): Promise<BundleDetail> {
    const inserted = await sql<{ id: string }>`
      INSERT INTO bundles (tenant_id, branch_id, name, kind, label, price_cents, status, online_booking_enabled, starts_at, ends_at, usage_limit, metric_note, created_by_user_id)
      VALUES (${ctx.tenantId}, ${ctx.branchId || null}, ${req.name.trim()}, ${req.kind}, ${req.label ?? null}, ${Math.max(0, Math.round(req.priceCents))},
              ${req.status ?? 'active'}, ${req.onlineBookingEnabled ?? true}, ${req.startsAt ?? null}, ${req.endsAt ?? null},
              ${req.usageLimit ?? null}, ${req.metricNote ?? null}, ${ctx.userId})
      RETURNING id`.execute(this.db);
    const id = inserted.rows[0]!.id;
    await this.insertItems(ctx, id, req.items);
    return (await this.detail(ctx, id))!;
  }

  async update(ctx: BundlesContext, bundleId: string, req: UpdateBundleRequest): Promise<BundleDetail | null> {
    const existing = await this.detail(ctx, bundleId);
    if (!existing) return null;
    // Patch scalar fields individually (each scoped) so undefined fields are left untouched.
    const set = async (frag: any) => { await sql`UPDATE bundles SET ${frag}, updated_at = now() WHERE id = ${bundleId} AND tenant_id = ${ctx.tenantId}`.execute(this.db); };
    if (req.name !== undefined) await set(sql`name = ${req.name.trim()}`);
    if (req.kind !== undefined) await set(sql`kind = ${req.kind}`);
    if (req.label !== undefined) await set(sql`label = ${req.label}`);
    if (req.priceCents !== undefined) await set(sql`price_cents = ${Math.max(0, Math.round(req.priceCents))}`);
    if (req.status !== undefined) await set(sql`status = ${req.status}`);
    if (req.onlineBookingEnabled !== undefined) await set(sql`online_booking_enabled = ${req.onlineBookingEnabled}`);
    if (req.startsAt !== undefined) await set(sql`starts_at = ${req.startsAt}`);
    if (req.endsAt !== undefined) await set(sql`ends_at = ${req.endsAt}`);
    if (req.usageLimit !== undefined) await set(sql`usage_limit = ${req.usageLimit}`);
    if (req.metricNote !== undefined) await set(sql`metric_note = ${req.metricNote}`);
    if (req.items !== undefined) {
      await sql`DELETE FROM bundle_items WHERE bundle_id = ${bundleId} AND tenant_id = ${ctx.tenantId}`.execute(this.db);
      await this.insertItems(ctx, bundleId, req.items);
    }
    return this.detail(ctx, bundleId);
  }

  async setStatus(ctx: BundlesContext, bundleId: string, status: BundleStatus): Promise<BundleRow | null> {
    const existing = await this.detail(ctx, bundleId);
    if (!existing) return null;
    if (status === 'archived') await sql`UPDATE bundles SET status = ${status}, archived_at = now(), updated_at = now() WHERE id = ${bundleId} AND tenant_id = ${ctx.tenantId} AND ${canMoveToSql(BUNDLE, status)}`.execute(this.db);
    else await sql`UPDATE bundles SET status = ${status}, archived_at = NULL, updated_at = now() WHERE id = ${bundleId} AND tenant_id = ${ctx.tenantId} AND ${canMoveToSql(BUNDLE, status)}`.execute(this.db);
    const [b] = await this.load(ctx, bundleId);
    return b ? toRow(b, new Date().toISOString()) : { ...existing, status };
  }
}
