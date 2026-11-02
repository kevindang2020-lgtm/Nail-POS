// deals-marketplace.kysely.ts — the deals reads and writes that span salons.
// CROSS-TENANT BY DESIGN: the public marketplace (nearby feed + public deal detail) shows active deals of every salon to
// guests, and Super Admin oversight (overview, list, suspend, per-salon switch and limits) acts across salons behind
// SuperAdminGuard. Every write still names the deal's own tenant in its WHERE.
//
// BUILD_PLAN Phase 5:
//   bug 16 — the nearby feed loaded the 500 NEWEST deals platform-wide and only then filtered by distance, so a guest in
//            one city saw nothing once 500 deals existed elsewhere. It now filters by a bounding box around the guest in
//            SQL (then the exact haversine radius in nearby-core), and honours the date window, the platform switch, the
//            salon's own switch and suspension.
//   bug 17 — Super Admin suspend took no reason, wrote no audit, and a deal a customer had ALREADY BOOKED still applied at
//            checkout. Suspension now needs a reason, is audited and a deal.suspended fact, and gives back every place
//            not yet paid for (booked and on-ticket), so the deal no longer applies anywhere.
import { sql } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { DEAL_REDEMPTION_HOLD, DEAL_REDEMPTION, DEAL } from '../engine/deal-lifecycles';
import type { NearbyQuery, MarketplaceOverview, AdminDealRow } from './deals.repository';

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
const MILES_PER_DEG_LAT = 69.0;

/** The latitude/longitude box that contains a circle of `radiusMiles` around a point. */
export function boundingBox(lat: number, lng: number, radiusMiles: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = radiusMiles / MILES_PER_DEG_LAT;
  const dLng = radiusMiles / (MILES_PER_DEG_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

export class KyselyDealsMarketplace {
  constructor(private readonly db: AppDatabase, private readonly outbox: OutboxWriter | null = null) {}
  private get d(): any { return this.db; }

  async nearbyActiveDealRows(q: NearbyQuery = {}): Promise<any[]> {
    const box = q.origin ? boundingBox(q.origin.lat, q.origin.lng, q.radiusMiles ?? 25) : null;
    return rowsOf(await sql`
      SELECT d.id, d.title, d.short_description, d.image_url, d.owner_type, d.technician_id, d.kind,
             d.discount_type, d.discount_percent, d.discount_cents, d.original_price_cents, d.final_price_cents, d.ends_at, d.created_at,
             d.new_customers_only, d.member_only,
             b.id AS branch_id, b.name AS branch_name, b.address, b.latitude, b.longitude,
             t.display_name AS salon_name, tech.full_name AS technician_name
      FROM deals d
      JOIN branches b ON (b.id = d.branch_id OR (d.branch_id IS NULL AND b.tenant_id = d.tenant_id)) AND b.tenant_id = d.tenant_id
      JOIN tenants t ON t.id = d.tenant_id AND t.status = 'active'
      LEFT JOIN deal_settings s ON s.tenant_id = d.tenant_id
      LEFT JOIN technicians tech ON tech.id = d.technician_id AND tech.tenant_id = d.tenant_id
      WHERE d.status = 'active' AND d.kind = 'deal' AND d.suspended_at IS NULL AND b.status = 'active'
        AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL
        AND (d.starts_at IS NULL OR d.starts_at <= now()) AND (d.ends_at IS NULL OR d.ends_at > now())
        AND (d.channels IS NULL OR 'customer_app' = ANY(d.channels))
        AND COALESCE(s.platform_disabled, false) = false AND COALESCE(s.deals_enabled, true) = true
        -- a deal with no place left (every place held, booked or used) or no budget left is not advertised
        AND (d.max_redemptions IS NULL OR (SELECT count(*) FROM deal_redemption_holds h WHERE h.tenant_id = d.tenant_id AND h.deal_id = d.id
               AND (h.status IN ('consumed','redeemed') OR (h.status = 'held' AND h.expires_at > now()))) < d.max_redemptions)
        AND (d.budget_cents IS NULL OR d.budget_reserved_cents < d.budget_cents)
        ${box ? sql`AND b.latitude BETWEEN ${box.minLat} AND ${box.maxLat} AND b.longitude BETWEEN ${box.minLng} AND ${box.maxLng}` : sql``}
        ${q.ownerType ? sql`AND d.owner_type = ${q.ownerType}` : sql``}
        ${q.maxPriceCents != null ? sql`AND d.final_price_cents <= ${q.maxPriceCents}` : sql``}
        ${q.newCustomerFriendly ? sql`AND d.member_only = false` : sql``}
        ${q.search ? sql`AND (d.title ILIKE ${'%' + q.search + '%'} OR t.display_name ILIKE ${'%' + q.search + '%'})` : sql``}
        ${q.categoryId ? sql`AND EXISTS (SELECT 1 FROM deal_services ds JOIN services sv ON sv.id = ds.service_id AND sv.tenant_id = ds.tenant_id WHERE ds.deal_id = d.id AND sv.category_id = ${q.categoryId})` : sql``}
      ORDER BY d.created_at DESC LIMIT 500
    `.execute(this.d)).map((r: any) => ({
      id: String(r.id), title: String(r.title), shortDescription: r.short_description ?? null, imageUrl: r.image_url ?? null,
      ownerType: String(r.owner_type), technicianId: r.technician_id ? String(r.technician_id) : null, technicianName: r.technician_name ?? null,
      discountType: String(r.discount_type), discountPercent: r.discount_percent == null ? null : Number(r.discount_percent),
      discountCents: r.discount_cents == null ? null : Number(r.discount_cents),
      originalPriceCents: r.original_price_cents == null ? null : Number(r.original_price_cents),
      finalPriceCents: r.final_price_cents == null ? null : Number(r.final_price_cents), endsAt: iso(r.ends_at),
      branchId: String(r.branch_id), branchName: r.branch_name ?? null, address: r.address ?? null, salonName: r.salon_name ?? null,
      latitude: r.latitude == null ? null : Number(r.latitude), longitude: r.longitude == null ? null : Number(r.longitude),
      newCustomersOnly: !!r.new_customers_only, memberOnly: !!r.member_only,
    }));
  }

  /** A deal a guest may see: live, in its window, not suspended, its salon active and deals switched on. */
  async getPublicDealRow(id: string): Promise<any | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const r = rowsOf(await sql`
      SELECT d.*, b.name AS branch_name, b.address, b.latitude, b.longitude, t.display_name AS salon_name, tech.full_name AS technician_name
      FROM deals d
      LEFT JOIN branches b ON b.id = d.branch_id AND b.tenant_id = d.tenant_id
      JOIN tenants t ON t.id = d.tenant_id AND t.status = 'active'
      LEFT JOIN deal_settings s ON s.tenant_id = d.tenant_id
      LEFT JOIN technicians tech ON tech.id = d.technician_id AND tech.tenant_id = d.tenant_id
      WHERE d.id = ${id} AND d.status = 'active' AND d.kind IN ('deal','announcement') AND d.suspended_at IS NULL
        AND (d.ends_at IS NULL OR d.ends_at > now())
        AND COALESCE(s.platform_disabled, false) = false AND COALESCE(s.deals_enabled, true) = true
      LIMIT 1
    `.execute(this.d))[0];
    if (!r) return null;
    r.service_ids = rowsOf(await sql`SELECT service_id FROM deal_services WHERE tenant_id = ${r.tenant_id} AND deal_id = ${id}`.execute(this.d)).map((x) => String(x.service_id));
    return r;
  }

  // ── Super Admin oversight ────────────────────────────────────────────────────────────────────────────────────────
  async marketplaceOverview(): Promise<MarketplaceOverview & Record<string, number>> {
    const d = rowsOf(await sql`
      SELECT count(*) AS total, count(*) FILTER (WHERE status='active') AS active, count(*) FILTER (WHERE status='pending_approval') AS pending,
        count(*) FILTER (WHERE suspended_at IS NOT NULL) AS suspended, coalesce(sum(redemption_count),0) AS redemptions, count(DISTINCT tenant_id) AS tenants,
        count(*) FILTER (WHERE kind='coupon') AS coupons, count(*) FILTER (WHERE kind='automatic') AS automatic
      FROM deals`.execute(this.d))[0];
    const money = rowsOf(await sql`
      SELECT coalesce(sum(amount_discounted_cents - reversed_cents) FILTER (WHERE status IN ('redeemed','partially_reversed')),0) AS discounted,
             count(*) FILTER (WHERE status = 'reversed') AS reversed, count(*) FILTER (WHERE status = 'applied') AS open_applications,
             coalesce(sum(amount_discounted_cents) FILTER (WHERE status IN ('redeemed','partially_reversed') AND redeemed_at > now() - interval '30 days'),0) AS discounted30
      FROM deal_redemptions`.execute(this.d))[0];
    const off = rowsOf(await sql`SELECT count(*) FILTER (WHERE platform_disabled) AS off FROM deal_settings`.execute(this.d))[0];
    return {
      totalDeals: Number(d?.total || 0), active: Number(d?.active || 0), pendingApproval: Number(d?.pending || 0), suspended: Number(d?.suspended || 0),
      totalRedemptions: Number(d?.redemptions || 0), totalDiscountedCents: Number(money?.discounted || 0), discountedLast30DaysCents: Number(money?.discounted30 || 0),
      reversedRedemptions: Number(money?.reversed || 0), openApplications: Number(money?.open_applications || 0),
      tenantsWithDeals: Number(d?.tenants || 0), coupons: Number(d?.coupons || 0), automatic: Number(d?.automatic || 0), tenantsSwitchedOff: Number(off?.off || 0),
    };
  }

  async listAllDeals(f: { status?: string | null; tenantId?: string | null; kind?: string | null; search?: string | null; suspended?: boolean | null } = {}): Promise<AdminDealRow[]> {
    const rows = rowsOf(await sql`
      SELECT d.id, d.tenant_id, d.title, d.owner_type, d.kind, d.status, d.redemption_count, d.created_at, d.suspended_reason, d.suspended_at,
             d.discount_type, d.discount_percent, d.discount_cents, d.max_redemptions, d.budget_cents, d.budget_reserved_cents, d.ends_at, t.display_name AS salon_name
      FROM deals d LEFT JOIN tenants t ON t.id = d.tenant_id
      WHERE true
        ${f.status ? sql`AND d.status = ${f.status}` : sql``}
        ${f.tenantId ? sql`AND d.tenant_id = ${f.tenantId}` : sql``}
        ${f.kind ? sql`AND d.kind = ${f.kind}` : sql``}
        ${f.suspended ? sql`AND d.suspended_at IS NOT NULL` : sql``}
        ${f.search ? sql`AND (d.title ILIKE ${'%' + f.search + '%'} OR t.display_name ILIKE ${'%' + f.search + '%'})` : sql``}
      ORDER BY d.created_at DESC LIMIT 500`.execute(this.d));
    return rows.map((r: any) => ({ id: String(r.id), tenantId: String(r.tenant_id), salonName: r.salon_name ?? null, title: String(r.title), ownerType: String(r.owner_type), kind: String(r.kind ?? 'deal'),
      status: String(r.status), redemptionCount: Number(r.redemption_count || 0), createdAt: iso(r.created_at), suspendedReason: r.suspended_reason ?? null, suspendedAt: iso(r.suspended_at),
      discountType: String(r.discount_type), discountPercent: r.discount_percent == null ? null : Number(r.discount_percent), discountCents: r.discount_cents == null ? null : Number(r.discount_cents),
      maxRedemptions: r.max_redemptions == null ? null : Number(r.max_redemptions), budgetCents: r.budget_cents == null ? null : Number(r.budget_cents), budgetReservedCents: Number(r.budget_reserved_cents || 0), endsAt: iso(r.ends_at) }));
  }

  /** Suspend a deal: it stops everywhere — the feed, new bookings, booked appointments, tickets not yet paid. */
  async superSuspendDeal(dealId: string, reason: string, actor: { userId: string | null; role?: string | null }): Promise<{ suspended: boolean; releasedPlaces: number; releasedApplications: number; tenantId: string | null }> {
    if (!/^[0-9a-f-]{36}$/i.test(String(dealId || ''))) return { suspended: false, releasedPlaces: 0, releasedApplications: 0, tenantId: null };
    return this.d.transaction().execute(async (trx: any) => {
      const before = rowsOf(await sql`SELECT tenant_id, status, branch_id FROM deals WHERE id = ${dealId} FOR UPDATE`.execute(trx))[0];
      if (!before) return { suspended: false, releasedPlaces: 0, releasedApplications: 0, tenantId: null };
      const tenantId = String(before.tenant_id);
      const row = rowsOf(await sql`UPDATE deals SET status = 'canceled', suspended_reason = ${reason}, suspended_by = ${actor.userId}, suspended_at = now(), version = version + 1, updated_at = now()
                                    WHERE tenant_id = ${tenantId} AND id = ${dealId} AND suspended_at IS NULL AND ${canMoveToSql(DEAL, 'canceled')} RETURNING id`.execute(trx))[0];
      if (!row) return { suspended: false, releasedPlaces: 0, releasedApplications: 0, tenantId };
      const apps = rowsOf(await sql`UPDATE deal_redemptions SET status = 'released', reversal_reason = 'deal_suspended', updated_at = now()
                                     WHERE ${canMoveToSql(DEAL_REDEMPTION, 'released')} AND tenant_id = ${tenantId} AND deal_id = ${dealId} AND status = 'applied' RETURNING id, coupon_code_id, budget_reserved_cents`.execute(trx));
      for (const a of apps) if (a.coupon_code_id) await sql`UPDATE deal_coupon_codes SET use_count = GREATEST(0, use_count - 1), updated_at = now() WHERE tenant_id = ${tenantId} AND id = ${a.coupon_code_id}`.execute(trx);
      const freed = apps.reduce((n: number, a: any) => n + Number(a.budget_reserved_cents || 0), 0);
      if (freed > 0) await sql`UPDATE deals SET budget_reserved_cents = GREATEST(0, budget_reserved_cents - ${freed}) WHERE tenant_id = ${tenantId} AND id = ${dealId}`.execute(trx);
      const holds = rowsOf(await sql`UPDATE deal_redemption_holds SET status = 'released', released_reason = 'deal_suspended', updated_at = now()
                                      WHERE ${canMoveToSql(DEAL_REDEMPTION_HOLD, 'released')} AND tenant_id = ${tenantId} AND deal_id = ${dealId} AND status IN ('held','consumed') RETURNING id`.execute(trx));
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${tenantId}, ${actor.userId && /^[0-9a-f-]{36}$/i.test(actor.userId) ? actor.userId : null}, ${actor.role ?? 'SUPER_ADMIN'}, 'deal_suspended_by_platform', 'deal', ${dealId},
                        ${JSON.stringify({ before: { status: before.status }, after: { status: 'canceled' }, reason, releasedPlaces: holds.length, releasedApplications: apps.length })}::jsonb)`.execute(trx);
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.DEAL_SUSPENDED, tenantId, branchId: before.branch_id ?? undefined, aggregateType: 'deal', aggregateId: dealId,
        actorId: actor.userId || undefined, actorType: 'user', payload: { dealId, from: String(before.status), reason, releasedPlaces: holds.length, releasedApplications: apps.length } }));
      return { suspended: true, releasedPlaces: holds.length, releasedApplications: apps.length, tenantId };
    });
  }

  /** Per-salon platform switch and plan limit (Super Admin). */
  async setTenantPlatform(tenantId: string, patch: { disabled?: boolean; reason?: string | null; maxActiveDeals?: number | null }, actor: { userId: string | null }): Promise<{ tenantId: string; platformDisabled: boolean; platformDisabledReason: string | null; platformMaxActiveDeals: number | null }> {
    const r = rowsOf(await sql`
      INSERT INTO deal_settings (tenant_id, platform_disabled, platform_disabled_reason, platform_max_active_deals, updated_at)
      VALUES (${tenantId}, ${!!patch.disabled}, ${patch.reason ?? null}, ${patch.maxActiveDeals ?? null}, now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        platform_disabled = ${patch.disabled === undefined ? sql`deal_settings.platform_disabled` : sql`${!!patch.disabled}`},
        platform_disabled_reason = ${patch.disabled === undefined ? sql`deal_settings.platform_disabled_reason` : sql`${patch.disabled ? patch.reason ?? null : null}`},
        platform_max_active_deals = ${patch.maxActiveDeals === undefined ? sql`deal_settings.platform_max_active_deals` : sql`${patch.maxActiveDeals}`},
        updated_at = now()
      RETURNING platform_disabled, platform_disabled_reason, platform_max_active_deals`.execute(this.d))[0];
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${tenantId}, ${actor.userId && /^[0-9a-f-]{36}$/i.test(actor.userId) ? actor.userId : null}, 'SUPER_ADMIN', 'deals_platform_settings_changed', 'deal_settings', ${tenantId}, ${JSON.stringify({ after: patch })}::jsonb)`.execute(this.d);
    return { tenantId, platformDisabled: !!r.platform_disabled, platformDisabledReason: r.platform_disabled_reason ?? null, platformMaxActiveDeals: r.platform_max_active_deals == null ? null : Number(r.platform_max_active_deals) };
  }

  /** The salons on the platform with their deal switches and activity (Super Admin "per-salon" view). */
  async tenantsOverview(limit = 200): Promise<any[]> {
    return rowsOf(await sql`
      SELECT t.id, t.display_name, COALESCE(s.platform_disabled,false) AS platform_disabled, s.platform_disabled_reason, s.platform_max_active_deals,
             COALESCE(s.deals_enabled,true) AS deals_enabled, COALESCE(s.stacking_policy,'best_single') AS stacking_policy,
             (SELECT count(*) FROM deals d WHERE d.tenant_id = t.id AND d.status = 'active') AS active_deals,
             (SELECT coalesce(sum(r.amount_discounted_cents - r.reversed_cents),0) FROM deal_redemptions r WHERE r.tenant_id = t.id AND r.status IN ('redeemed','partially_reversed') AND r.redeemed_at > now() - interval '30 days') AS discounted30
      FROM tenants t LEFT JOIN deal_settings s ON s.tenant_id = t.id
      WHERE EXISTS (SELECT 1 FROM deals d WHERE d.tenant_id = t.id) OR s.tenant_id IS NOT NULL
      ORDER BY t.display_name LIMIT ${limit}`.execute(this.d)).map((r: any) => ({ tenantId: String(r.id), salonName: r.display_name ?? null, platformDisabled: !!r.platform_disabled,
        platformDisabledReason: r.platform_disabled_reason ?? null, platformMaxActiveDeals: r.platform_max_active_deals == null ? null : Number(r.platform_max_active_deals),
        dealsEnabled: !!r.deals_enabled, stackingPolicy: String(r.stacking_policy), activeDeals: Number(r.active_deals || 0), discountedLast30DaysCents: Number(r.discounted30 || 0) }));
  }
}
