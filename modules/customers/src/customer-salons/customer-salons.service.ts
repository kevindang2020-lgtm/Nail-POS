// customer-salons.service.ts — public partner-salon directory + nearby search (build doc §14–§18, §24).
// Cross-tenant READ of public listing info ONLY: tenants opted into public_listing, their branches, name/address/
// coords/phone, a services preview, and the bookable flag. No private tenant data; tenancy for any subsequent booking
// is derived server-side from the salonId (§24: never trust tenantId from the frontend).
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { encodeCursor, decodeCursor } from '@aipowersalon/api-contracts';
import { GooglePlacesProvider } from './google-places.provider';
import {
  APP_FLAG_DEFAULTS, AppFlagKey, GOOGLE_NOT_CONFIGURED_MESSAGE, PartnerBranchRow, SalonResult,
  clampRadius, flagEnabled, mergeResults, partnerToResult,
} from './salon-directory-core';

export class SalonSearchError extends Error { constructor(public code: string, msg: string) { super(msg); } }

const DEF_RADIUS = () => Number(process.env.DEFAULT_NEARBY_RADIUS_MILES || 10) || 10;
/** B-28: the browse page (no location) and the bound of a located search (its radius box; sorted by distance after). */
export const BROWSE_DEFAULT_LIMIT = 50, BROWSE_MAX_LIMIT = 100, LOCATED_MAX_ROWS = 500;
const MAX_RADIUS = () => Number(process.env.MAX_NEARBY_RADIUS_MILES || 50) || 50;

@Injectable()
export class CustomerSalonsService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, private readonly google: GooglePlacesProvider) {}
  private need(): NonNullable<AppDatabase> { if (!this.db) throw new SalonSearchError('unavailable', 'Salon search requires a database.'); return this.db; }

  private async flagsByTenant(): Promise<Map<string, Map<string, boolean>>> {
    const rows: any[] = await (this.need() as any).selectFrom('tenant_app_flags').select(['tenant_id', 'flag_key', 'enabled']).execute().catch(() => []);
    const out = new Map<string, Map<string, boolean>>();
    for (const r of rows) {
      if (!out.has(String(r.tenant_id))) out.set(String(r.tenant_id), new Map());
      out.get(String(r.tenant_id))!.set(String(r.flag_key), !!r.enabled);
    }
    return out;
  }

  /** All publicly listed partner branches with a 3-service preview (active tenants only). */
  /** B-28 (Oct 20 2026): the listed partner branches — the public_listing flag, the city / state / zip / text filters, the
   *  radius bounding box and the page are all in the SQL (it used to read EVERY listed branch on the platform and filter in
   *  memory, with no page). Keyset page: ordered by (salon name, branch name, branch id), `cursor` = the last row (v2 codec).
   *  A located search is bounded by its radius box instead of a page (the radius is the bound; sorted by distance after). */
  private async listedBranches(filter?: { city?: string; state?: string; zip?: string; searchText?: string }, page?: { limit: number; cursor?: string | null }, box?: { lat: number; lng: number; radiusMiles: number }, onlyBranchId?: string): Promise<{ rows: PartnerBranchRow[]; nextCursor: string | null }> {
    const db = this.need();
    const flags = await this.flagsByTenant();
    let qb: any = (db as any).selectFrom('branches as b')
      .innerJoin('tenants as t', 't.id', 'b.tenant_id')
      .where('t.status', '=', 'active').where('b.status', '!=', 'archived')
      .where(sql`b.is_public IS DISTINCT FROM false`)
      .where(sql`b.deleted_at IS NULL`)
      .where(sql`b.verification_status IS DISTINCT FROM 'suspended'`)
      // public_listing defaults to false (APP_FLAG_DEFAULTS): listed = an explicit enabled override
      .where(sql`EXISTS (SELECT 1 FROM tenant_app_flags f WHERE f.tenant_id = t.id AND f.flag_key = 'public_listing' AND f.enabled = true)`)
      .select(['b.id as branch_id', 'b.tenant_id', 'b.name as branch_name', 'b.address', 'b.city', 'b.state', 'b.zip', 'b.phone', 'b.latitude', 'b.longitude', 't.display_name']);
    if (onlyBranchId) qb = qb.where('b.id', '=', onlyBranchId);
    if (filter?.city) qb = qb.where(sql`lower(coalesce(b.city, '')) = ${filter.city.toLowerCase()}`);
    if (filter?.state) qb = qb.where(sql`lower(coalesce(b.state, '')) = ${filter.state.toLowerCase()}`);
    if (filter?.zip) qb = qb.where(sql`coalesce(b.zip, '') = ${filter.zip}`);
    if (filter?.searchText) { const like = `%${filter.searchText.toLowerCase().replace(/[%_\\]/g, (c) => '\\' + c)}%`; qb = qb.where(sql`(lower(t.display_name) LIKE ${like} OR lower(b.name) LIKE ${like} OR lower(coalesce(b.city, '')) LIKE ${like})`); }
    if (box) {
      const dLat = box.radiusMiles / 69, dLng = box.radiusMiles / (69 * Math.max(0.1, Math.cos((box.lat * Math.PI) / 180)));
      qb = qb.where('b.latitude', '>=', box.lat - dLat).where('b.latitude', '<=', box.lat + dLat).where('b.longitude', '>=', box.lng - dLng).where('b.longitude', '<=', box.lng + dLng);
    }
    qb = qb.orderBy('t.display_name').orderBy('b.name').orderBy('b.id');
    let limit = 0;
    if (page) {
      limit = Math.min(Math.max(1, Math.trunc(page.limit || BROWSE_DEFAULT_LIMIT)), BROWSE_MAX_LIMIT);
      if (page.cursor) {
        const c = decodeCursor(page.cursor);
        if (!c || !Array.isArray(c.sortValue) || c.sortValue.length !== 2) throw new SalonSearchError('invalid', 'cursor is not valid — restart from the first page.');
        const [dn, bn] = c.sortValue.map(String);
        qb = qb.where(sql`(t.display_name, b.name, b.id) > (${dn}, ${bn}, ${c.id}::uuid)`);
      }
      qb = qb.limit(limit + 1);
    } else if (box) qb = qb.limit(LOCATED_MAX_ROWS);
    const branches: any[] = await qb.execute().catch(() => []);
    const more = page ? branches.length > limit : false;
    const filtered = more ? branches.slice(0, limit) : branches;
    const last = filtered[filtered.length - 1];
    const nextCursor = more && last ? encodeCursor({ sortValue: [String(last.display_name), String(last.branch_name ?? '')], id: String(last.branch_id) }) : null;
    const tenantIds = Array.from(new Set(filtered.map((b) => String(b.tenant_id))));
    const previews = new Map<string, string[]>();
    if (tenantIds.length) {
      const svcs: any[] = await (db as any).selectFrom('services').where('tenant_id', 'in', tenantIds)
        .where('status', '=', 'active').select(['tenant_id', 'name']).orderBy('name').execute().catch(() => []);
      for (const s of svcs) {
        const k = String(s.tenant_id);
        if (!previews.has(k)) previews.set(k, []);
        if (previews.get(k)!.length < 3) previews.get(k)!.push(String(s.name));
      }
    }
    // Per-branch public aggregates for the salon cards: rating (public + not manager-hidden reviews) and
    // public-profile technician count. Two grouped queries — no N+1.
    const branchIds = filtered.map((b) => String(b.branch_id));
    const ratingByBranch = new Map<string, { avg: number; cnt: number }>();
    const techCountByBranch = new Map<string, number>();
    if (branchIds.length) {
      const dbAny = db as any;
      const ratings: any[] = await dbAny.selectFrom('reviews')
        .where('branch_id', 'in', branchIds).where('is_public', '=', true).where('is_hidden_by_manager', '=', false)
        .select(['branch_id', dbAny.fn.avg('rating').as('avg'), dbAny.fn.count('id').as('cnt')])
        .groupBy('branch_id').execute().catch(() => []);
      for (const r of ratings) ratingByBranch.set(String(r.branch_id), { avg: Math.round(Number(r.avg) * 10) / 10, cnt: Number(r.cnt) });
      const techs: any[] = await dbAny.selectFrom('technicians as t')
        .innerJoin('global_tech_profiles as p', 'p.id', 't.global_tech_profile_id')
        .where('t.branch_id', 'in', branchIds).where('t.is_active', '=', true).where('p.is_public', '=', true)
        .select(['t.branch_id', dbAny.fn.count('t.id').as('cnt')]).groupBy('t.branch_id').execute().catch(() => []);
      for (const r of techs) techCountByBranch.set(String(r.branch_id), Number(r.cnt));
    }
    const rows = filtered.map((b) => ({
      branchId: String(b.branch_id), tenantId: String(b.tenant_id), branchName: String(b.branch_name || 'Main'), tenantDisplayName: String(b.display_name),
      address: b.address, city: b.city, state: b.state, zip: b.zip, phone: b.phone,
      latitude: b.latitude != null ? Number(b.latitude) : null, longitude: b.longitude != null ? Number(b.longitude) : null,
      bookable: flagEnabled('customer_app_booking', flags.get(String(b.tenant_id)) ?? new Map()),
      servicesPreview: previews.get(String(b.tenant_id)) ?? [],
      averageRating: ratingByBranch.get(String(b.branch_id))?.avg ?? null,
      reviewCount: ratingByBranch.get(String(b.branch_id))?.cnt ?? 0,
      technicianCount: techCountByBranch.get(String(b.branch_id)) ?? 0,
    }));
    return { rows, nextCursor };
  }

  /** §16 GET /customer/salons/nearby — partners first, optional Google merge, honest config message. */
  async nearby(q: { lat?: number; lng?: number; radiusMiles?: number; city?: string; state?: string; zip?: string; searchText?: string; limit?: number; cursor?: string }) {
    const radius = clampRadius(q.radiusMiles, DEF_RADIUS(), MAX_RADIUS());
    const origin = Number.isFinite(q.lat as number) && Number.isFinite(q.lng as number) ? { lat: Number(q.lat), lng: Number(q.lng) } : undefined;
    // B-28: no location = a paged browse (filters in SQL); a location = the radius box in SQL, then distance order
    const listed = origin
      ? await this.listedBranches({}, undefined, { ...origin, radiusMiles: radius })
      : await this.listedBranches({ city: q.city, state: q.state, zip: q.zip, searchText: q.searchText }, { limit: Number(q.limit) || BROWSE_DEFAULT_LIMIT, cursor: q.cursor ?? null });
    const partners = listed.rows.map((b) => partnerToResult(b, origin));
    let googleResults: SalonResult[] = [];
    let attribution: string | null = null;
    let googleMessage: string | null = null;
    if (origin) {
      if (this.google.enabled()) {
        const g = await this.google.nearby(origin.lat, origin.lng, radius, origin);
        googleResults = g.results; attribution = g.attribution;
      } else {
        googleMessage = GOOGLE_NOT_CONFIGURED_MESSAGE;
      }
    }
    const results = mergeResults(partners, googleResults, origin ? radius : Number.POSITIVE_INFINITY);
    return { results, radiusMiles: radius, googleEnabled: this.google.enabled(), googleMessage, attribution, nextCursor: listed.nextCursor };
  }

  /** One listed branch by id (B-28: the detail / favorites paths no longer read the whole directory to find one row). */
  private async listedBranchById(branchId: string): Promise<PartnerBranchRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(branchId)) return null;
    const { rows } = await this.listedBranches(undefined, undefined, undefined, branchId);
    return rows[0] ?? null;
  }

  /** §18 salon detail — partner only (Google-only detail stays on the client from the nearby payload). */
  async detail(salonId: string) {
    const b = await this.listedBranchById(salonId);
    if (!b) throw new SalonSearchError('not_found', 'Salon not found.');
    return partnerToResult(b);
  }

  /** Public services preview for a partner salon — tenant derived from the salonId server-side (§24). */
  async services(salonId: string) {
    const db = this.need();
    const branch: any = await (db as any).selectFrom('branches').where('id', '=', salonId).select(['tenant_id']).executeTakeFirst().catch(() => undefined);
    if (!branch) throw new SalonSearchError('not_found', 'Salon not found.');
    const flags = await this.flagsByTenant();
    if (!flagEnabled('public_listing', flags.get(String(branch.tenant_id)) ?? new Map())) throw new SalonSearchError('not_found', 'Salon not found.');
    const svcs: any[] = await (db as any).selectFrom('services').where('tenant_id', '=', branch.tenant_id)
      .where((eb: any) => eb.or([eb('branch_id', '=', salonId), eb('branch_id', 'is', null)]))
      .where('status', '=', 'active').select(['id', 'name', 'price_cents', 'duration_minutes', 'category_id']).orderBy('name').execute().catch(() => []);
    return svcs.map((s) => ({ serviceId: String(s.id), name: String(s.name), priceCents: Number(s.price_cents ?? 0), durationMinutes: Number(s.duration_minutes ?? 0) }));
  }

  // ── Salon-level favorites (§17/§21) — partner salons only (Google places can vanish; no stale hearts) ──
  async listFavorites(userId: string) {
    const rows: any[] = await (this.need() as any).selectFrom('customer_favorite_salons').where('user_id', '=', userId)
      .select(['salon_id']).orderBy('created_at', 'desc').execute().catch(() => []);
    const ids = new Set(rows.map((r) => String(r.salon_id)));
    const salons: ReturnType<typeof partnerToResult>[] = [];
    for (const id of ids) { const b = await this.listedBranchById(id).catch(() => null); if (b) salons.push(partnerToResult(b)); }
    return { salonIds: Array.from(ids), salons };
  }

  async addFavorite(userId: string, salonId: string) {
    if (!(await this.listedBranchById(salonId).catch(() => null))) throw new SalonSearchError('not_found', 'Salon not found.');
    await (this.need() as any).insertInto('customer_favorite_salons').values({ user_id: userId, salon_id: salonId })
      .onConflict((oc: any) => oc.columns(['user_id', 'salon_id']).doNothing()).execute();
    return { ok: true as const, salonId };
  }

  async removeFavorite(userId: string, salonId: string) {
    await (this.need() as any).deleteFrom('customer_favorite_salons').where('user_id', '=', userId).where('salon_id', '=', salonId).execute();
    return { ok: true as const, salonId };
  }

  /** §26 read model: every flag with its effective value, explicit override (if any), and default. */
  async listAppFlags(tenantId: string) {
    const rows: any[] = await (this.need() as any).selectFrom('tenant_app_flags').where('tenant_id', '=', tenantId)
      .select(['flag_key', 'enabled']).execute().catch(() => []);
    const overrides = new Map(rows.map((r) => [String(r.flag_key), !!r.enabled]));
    return Object.entries(APP_FLAG_DEFAULTS).map(([key, def]) => ({
      key, default: def, override: overrides.has(key) ? overrides.get(key)! : null, enabled: overrides.get(key) ?? def,
    }));
  }

  /** Super Admin flag setter (§26) — explicit override rows, null reverts to default. */
  async setAppFlag(tenantId: string, flagKey: string, enabled: boolean | null) {
    if (!Object.prototype.hasOwnProperty.call(APP_FLAG_DEFAULTS, flagKey)) throw new SalonSearchError('invalid', `flag must be one of ${Object.keys(APP_FLAG_DEFAULTS).join(', ')}.`);
    const db = this.need();
    if (enabled === null) {
      await (db as any).deleteFrom('tenant_app_flags').where('tenant_id', '=', tenantId).where('flag_key', '=', flagKey).execute();
      return { tenantId, flagKey, enabled: APP_FLAG_DEFAULTS[flagKey as AppFlagKey] };
    }
    await (db as any).insertInto('tenant_app_flags').values({ tenant_id: tenantId, flag_key: flagKey, enabled })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'flag_key']).doUpdateSet({ enabled, updated_at: new Date() })).execute();
    return { tenantId, flagKey, enabled };
  }
}
