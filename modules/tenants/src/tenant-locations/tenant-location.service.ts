// tenant-location.service.ts — canonical tenant-side Salon Location manager. Reads/writes the `branches`
// record (NOT a parallel table), always scoped to the session tenant. Handles draft→confirm→publish,
// map-pin moves (with history), geocoding via MapsGeocodingProvider, duplicate detection, and audit.
// Framework-free (raw SQL via kysely `sql`); the controller maps LocationError.status → HttpException.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { MapsGeocodingProvider } from './maps-geocoding.provider';
import type { EntitlementsService } from '@aipowersalon/platform';
import {
  LocationRow, publishReadiness, validCoords, detectDuplicate, toPublicLocation, summarize, accuracyAfterDrag,
} from './location-core';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class LocationError extends Error { constructor(public status: number, message: string, public extra?: any) { super(message); } }
export interface LocCtx { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[] }

const SELECT_COLS = `id, tenant_id, name, public_display_name, salon_code, description, phone, public_email, website,
  address, address_line2, suite_unit, city, state, zip, country_code, formatted_address, google_place_id,
  latitude, longitude, map_accuracy, map_pin_confirmed_at, timezone, status, verification_status,
  is_public, is_online_booking_enabled, accepts_walk_ins, show_phone_publicly, show_address_publicly,
  show_prices_publicly, booking_lead_minutes, published_at, verified_at, updated_at,
  manager_name, manager_phone, manager_email, internal_notes`;

const WRITABLE = new Set([
  'name', 'public_display_name', 'salon_code', 'description', 'phone', 'public_email', 'website',
  'address', 'address_line2', 'suite_unit', 'city', 'state', 'zip', 'country_code', 'formatted_address',
  'timezone', 'is_online_booking_enabled', 'accepts_walk_ins', 'show_phone_publicly', 'show_address_publicly',
  'show_prices_publicly', 'booking_lead_minutes', 'manager_name', 'manager_phone', 'manager_email', 'internal_notes',
]);

export class TenantLocationService {
  constructor(private readonly db: Kysely<DB> | null, private readonly maps: MapsGeocodingProvider, private readonly clock: { iso(): string } = { iso: () => new Date().toISOString() }, private readonly entitlements?: EntitlementsService) {}
  private need(): Kysely<DB> { if (!this.db) throw withCode(new LocationError(503, 'Location store unavailable'), 'SERVICE_UNAVAILABLE'); return this.db; }

  private async audit(ctx: LocCtx, locationId: string, action: string, meta: any) {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
        VALUES (${ctx.tenantId}, ${locationId}, ${ctx.userId}, ${ctx.role}, ${action}, ${'tenant_location'}, ${locationId}, ${JSON.stringify(meta || {})}::jsonb)`.execute(this.db);
    } catch { /* never let audit break the operation */ }
  }

  private async row(ctx: LocCtx, id: string): Promise<LocationRow> {
    const r = await sql<LocationRow>`SELECT ${sql.raw(SELECT_COLS)} FROM branches WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`.execute(this.need());
    const loc = r.rows[0];
    if (!loc) throw withCode(new LocationError(404, 'Location not found'), 'LOCATION_NOT_FOUND');
    return loc;
  }

  async list(ctx: LocCtx) {
    const r = await sql<LocationRow>`SELECT ${sql.raw(SELECT_COLS)} FROM branches WHERE tenant_id = ${ctx.tenantId} AND deleted_at IS NULL ORDER BY name`.execute(this.need());
    return { locations: r.rows, summary: summarize(r.rows) };
  }

  async get(ctx: LocCtx, id: string) { return { location: await this.row(ctx, id) }; }

  private async dupCandidates(ctx: LocCtx, placeId?: string | null) {
    const r = await sql<any>`SELECT id, tenant_id, google_place_id, phone, salon_code, name, city, state, latitude, longitude
      FROM branches WHERE deleted_at IS NULL AND (tenant_id = ${ctx.tenantId} OR (${placeId ?? null}::text IS NOT NULL AND google_place_id = ${placeId ?? null}))`.execute(this.need());
    return r.rows;
  }

  async create(ctx: LocCtx, body: any) {
    const name = String(body?.name || '').trim();
    if (!name) throw withCode(new LocationError(400, 'Branch/location name is required'), 'LOCATION_NAME_REQUIRED');
    const dup = detectDuplicate(
      { tenant_id: ctx.tenantId, google_place_id: body?.google_place_id, phone: body?.phone, salon_code: body?.salon_code, name, city: body?.city, state: body?.state, latitude: body?.latitude, longitude: body?.longitude },
      await this.dupCandidates(ctx, body?.google_place_id),
    );
    if (dup.verdict === 'exact_block') throw new LocationError(409, dup.reason || 'Duplicate location', { code: 'duplicate', matchId: dup.matchId });
    if (this.entitlements) {
      const c = await this.entitlements.checkLimit(ctx.tenantId, 'branches');
      if (c.usedKnown && !c.allowed) throw new LocationError(409, c.reason || 'Branch limit reached', { code: 'limit_reached' });
    }
    const initialVerification = dup.verdict === 'cross_tenant_review' ? 'pending_review' : 'draft';
    const r = await sql<{ id: string }>`
      INSERT INTO branches (tenant_id, name, public_display_name, salon_code, description, phone, public_email, website,
        address, address_line2, suite_unit, city, state, zip, country_code, status, verification_status, is_public)
      VALUES (${ctx.tenantId}, ${name}, ${body?.public_display_name ?? null}, ${body?.salon_code ?? null}, ${body?.description ?? null},
        ${body?.phone ?? null}, ${body?.public_email ?? null}, ${body?.website ?? null}, ${body?.address ?? null},
        ${body?.address_line2 ?? null}, ${body?.suite_unit ?? null}, ${body?.city ?? null}, ${body?.state ?? null},
        ${body?.zip ?? null}, ${body?.country_code ?? 'US'}, ${'active'}, ${initialVerification}, ${false})
      RETURNING id`.execute(this.need());
    const id = r.rows[0].id;
    await this.audit(ctx, id, 'location_created', { name, dup: dup.verdict });
    return { location: await this.row(ctx, id), warning: dup.verdict === 'probable_warn' ? dup.reason : undefined };
  }

  async update(ctx: LocCtx, id: string, body: any) {
    await this.row(ctx, id); // ensures tenant ownership
    const sets: ReturnType<typeof sql>[] = [];
    for (const k of Object.keys(body || {})) {
      if (!WRITABLE.has(k)) continue;
      sets.push(sql`${sql.ref(k)} = ${body[k] ?? null}`);
    }
    if (sets.length === 0) return { location: await this.row(ctx, id) };
    await sql`UPDATE branches SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, id, 'location_updated', { fields: Object.keys(body || {}).filter((k) => WRITABLE.has(k)) });
    return { location: await this.row(ctx, id) };
  }

  /** Address search / autocomplete proxy (server key only). */
  async geocode(_ctx: LocCtx, query: string) {
    const out = await this.maps.searchAddress(query, 6);
    return { configured: out.configured, candidates: out.hits };
  }

  /** Apply a geocoded address (fills structured fields + coordinates, accuracy from provider). */
  async applyAddress(ctx: LocCtx, id: string, hit: any) {
    const before = await this.row(ctx, id);
    if (!validCoords(hit?.latitude, hit?.longitude)) throw withCode(new LocationError(400, 'Selected address has no valid coordinates'), 'COORDINATES_INVALID');
    await this.recordMapHistory(ctx, id, before, hit.latitude, hit.longitude, hit.formattedAddress, 'geocode');
    await sql`UPDATE branches SET latitude = ${hit.latitude}, longitude = ${hit.longitude}, formatted_address = ${hit.formattedAddress ?? null},
      google_place_id = ${hit.placeId ?? null}, city = COALESCE(${hit.city ?? null}, city), state = COALESCE(${hit.state ?? null}, state),
      zip = COALESCE(${hit.zip ?? null}, zip), map_accuracy = ${'needs_confirmation'}, map_pin_confirmed_at = NULL, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, id, 'location_address_changed', { to: hit.formattedAddress, placeId: hit.placeId ?? null });
    return { location: await this.row(ctx, id) };
  }

  /** Manual pin move (drag/click). Optionally reverse-geocodes; records history; needs re-confirmation. */
  async setMapPin(ctx: LocCtx, id: string, lat: number, lng: number, source = 'manual_drag') {
    if (!validCoords(lat, lng)) throw withCode(new LocationError(400, 'Invalid coordinates'), 'COORDINATES_INVALID');
    const before = await this.row(ctx, id);
    const acc = accuracyAfterDrag(before.latitude, before.longitude, lat, lng);
    const rev = await this.maps.reverseGeocode(lat, lng);
    const newAddr = rev.hit?.formattedAddress ?? before.formatted_address ?? null;
    await this.recordMapHistory(ctx, id, before, lat, lng, newAddr, source);
    await sql`UPDATE branches SET latitude = ${lat}, longitude = ${lng}, map_accuracy = ${'manually_adjusted'},
      formatted_address = COALESCE(${newAddr}, formatted_address), map_pin_confirmed_at = NULL, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, id, 'location_map_pin_changed', { lat, lng, source, metersOff: acc.metersOff });
    return { location: await this.row(ctx, id), warning: acc.farFromAddress ? 'Pin is far from the entered address — please confirm it is correct.' : undefined, reverseGeocoded: newAddr };
  }

  async confirmPin(ctx: LocCtx, id: string) {
    const loc = await this.row(ctx, id);
    if (!validCoords(loc.latitude as any, loc.longitude as any)) throw withCode(new LocationError(400, 'Set a valid map pin before confirming'), 'COORDINATES_INVALID');
    await sql`UPDATE branches SET map_accuracy = ${'exact'}, map_pin_confirmed_at = now(), map_pin_confirmed_by = ${ctx.userId},
      verification_status = CASE WHEN verification_status = 'draft' THEN 'manager_confirmed' ELSE verification_status END, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, id, 'location_pin_confirmed', { lat: loc.latitude, lng: loc.longitude });
    return { location: await this.row(ctx, id) };
  }

  async publish(ctx: LocCtx, id: string) {
    const loc = await this.row(ctx, id);
    const check = publishReadiness(loc);
    if (!check.ok) throw new LocationError(422, 'Cannot publish yet — missing: ' + check.missing.join(', '), { code: 'not_ready', missing: check.missing });
    await sql`UPDATE branches SET is_public = true, published_at = now(), unpublished_at = NULL,
      verification_status = CASE WHEN verification_status IN ('verified','suspended','rejected') THEN verification_status ELSE 'pending_review' END,
      updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    // ensure the tenant-level discovery flag is on so the branch can appear in the customer directory
    await sql`INSERT INTO tenant_app_flags (tenant_id, flag_key, enabled) VALUES (${ctx.tenantId}, ${'public_listing'}, ${true})
      ON CONFLICT (tenant_id, flag_key) DO UPDATE SET enabled = true, updated_at = now()`.execute(this.need());
    await this.audit(ctx, id, 'location_published', {});
    return { location: await this.row(ctx, id) };
  }

  async unpublish(ctx: LocCtx, id: string) {
    await this.row(ctx, id);
    await sql`UPDATE branches SET is_public = false, unpublished_at = now(), verification_status = 'unpublished', updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, id, 'location_unpublished', {});
    return { location: await this.row(ctx, id) };
  }

  async publicPreview(ctx: LocCtx, id: string) {
    const loc = await this.row(ctx, id);
    const t = await sql<{ display_name: string }>`SELECT display_name FROM tenants WHERE id = ${ctx.tenantId}`.execute(this.need());
    return { preview: toPublicLocation(loc, t.rows[0]?.display_name || 'Salon') };
  }

  private async recordMapHistory(ctx: LocCtx, id: string, before: LocationRow, newLat: number, newLng: number, newAddr: string | null, source: string) {
    if (!this.db) return;
    try {
      await sql`INSERT INTO tenant_location_map_history (tenant_id, location_id, previous_latitude, previous_longitude, new_latitude, new_longitude, previous_address, new_address, changed_by, change_source)
        VALUES (${ctx.tenantId}, ${id}, ${before.latitude}, ${before.longitude}, ${newLat}, ${newLng}, ${before.formatted_address ?? before.address}, ${newAddr}, ${ctx.userId}, ${source})`.execute(this.db);
    } catch { /* history is best-effort */ }
  }
}
