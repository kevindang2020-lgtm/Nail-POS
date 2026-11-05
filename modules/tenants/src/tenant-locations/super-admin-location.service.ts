// super-admin-location.service.ts — platform-wide location verification (cross-tenant READ + verify/reject/
// suspend/correct). SuperAdminGuard-gated controller. Approval never grants a tenant access to another
// tenant's data; it only flips verification flags on the branch row. Audit is written per affected branch.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { summarize, validCoords, type LocationRow } from './location-core';

export class SaLocationError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface SaCtx { userId: string; role: string }

const COLS = `b.id, b.tenant_id, b.name, b.public_display_name, b.salon_code, b.description, b.phone, b.public_email, b.website,
  b.address, b.address_line2, b.suite_unit, b.city, b.state, b.zip, b.country_code, b.formatted_address, b.google_place_id,
  b.latitude, b.longitude, b.map_accuracy, b.map_pin_confirmed_at, b.timezone, b.status, b.verification_status,
  b.is_public, b.is_online_booking_enabled, b.accepts_walk_ins, b.show_phone_publicly, b.show_address_publicly,
  b.show_prices_publicly, b.booking_lead_minutes, b.published_at, b.verified_at, b.updated_at`;

export class SuperAdminLocationService {
  constructor(private readonly db: Kysely<DB> | null) {}
  private need(): Kysely<DB> { if (!this.db) throw new SaLocationError(503, 'Location store unavailable'); return this.db; }

  async list(q: { search?: string; status?: string }) {
    const search = (q?.search || '').trim().toLowerCase();
    const r = await sql<any>`
      SELECT ${sql.raw(COLS)}, t.display_name AS tenant_display_name
      FROM branches b JOIN tenants t ON t.id = b.tenant_id
      WHERE b.deleted_at IS NULL
        AND (${q?.status ?? null}::text IS NULL OR b.verification_status = ${q?.status ?? null})
        AND (${search || null}::text IS NULL OR lower(coalesce(t.display_name,'')||' '||coalesce(b.name,'')||' '||coalesce(b.city,'')||' '||coalesce(b.state,'')||' '||coalesce(b.zip,'')||' '||coalesce(b.salon_code,'')) LIKE ${'%' + search + '%'})
      ORDER BY b.verification_status, t.display_name, b.name`.execute(this.need());
    return { locations: r.rows, summary: summarize(r.rows as LocationRow[]) };
  }

  async summary() { return (await this.list({})).summary; }

  async detail(id: string) {
    const r = await sql<any>`SELECT ${sql.raw(COLS)}, t.display_name AS tenant_display_name FROM branches b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = ${id}`.execute(this.need());
    if (!r.rows[0]) throw new SaLocationError(404, 'Location not found');
    const hist = await sql<any>`SELECT previous_latitude, previous_longitude, new_latitude, new_longitude, previous_address, new_address, change_source, created_at
      FROM tenant_location_map_history WHERE location_id = ${id} ORDER BY created_at DESC LIMIT 25`.execute(this.need());
    return { location: r.rows[0], mapHistory: hist.rows };
  }

  private async audit(ctx: SaCtx, tenantId: string, id: string, action: string, meta: any) {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
        VALUES (${tenantId}, ${id}, ${ctx.userId}, ${ctx.role}, ${action}, ${'tenant_location'}, ${id}, ${JSON.stringify(meta || {})}::jsonb)`.execute(this.db);
    } catch { /* best effort */ }
  }
  private async tenantOf(id: string): Promise<string> {
    const r = await sql<{ tenant_id: string }>`SELECT tenant_id FROM branches WHERE id = ${id}`.execute(this.need());
    if (!r.rows[0]) throw new SaLocationError(404, 'Location not found');
    return r.rows[0].tenant_id;
  }

  async verify(ctx: SaCtx, id: string) {
    const tid = await this.tenantOf(id);
    await sql`UPDATE branches SET verification_status = 'verified', verified_at = now(), verified_by = ${ctx.userId},
      is_public = COALESCE(is_public, true), updated_at = now() WHERE id = ${id}`.execute(this.need());
    await this.audit(ctx, tid, id, 'location_verified', {});
    return this.detail(id);
  }
  async reject(ctx: SaCtx, id: string, reason?: string) {
    const tid = await this.tenantOf(id);
    await sql`UPDATE branches SET verification_status = 'rejected', is_public = false, updated_at = now() WHERE id = ${id}`.execute(this.need());
    await this.audit(ctx, tid, id, 'location_rejected', { reason: reason || null });
    return this.detail(id);
  }
  async suspend(ctx: SaCtx, id: string, reason?: string) {
    const tid = await this.tenantOf(id);
    await sql`UPDATE branches SET verification_status = 'suspended', is_public = false, updated_at = now() WHERE id = ${id}`.execute(this.need());
    await this.audit(ctx, tid, id, 'location_suspended', { reason: reason || null });
    return this.detail(id);
  }
  async correctPin(ctx: SaCtx, id: string, lat: number, lng: number) {
    if (!validCoords(lat, lng)) throw new SaLocationError(400, 'Invalid coordinates');
    const tid = await this.tenantOf(id);
    const before = await sql<any>`SELECT latitude, longitude, formatted_address FROM branches WHERE id = ${id}`.execute(this.need());
    const b = before.rows[0] || {};
    await sql`INSERT INTO tenant_location_map_history (tenant_id, location_id, previous_latitude, previous_longitude, new_latitude, new_longitude, previous_address, new_address, changed_by, change_source)
      VALUES (${tid}, ${id}, ${b.latitude ?? null}, ${b.longitude ?? null}, ${lat}, ${lng}, ${b.formatted_address ?? null}, ${b.formatted_address ?? null}, ${ctx.userId}, ${'super_admin'})`.execute(this.need());
    await sql`UPDATE branches SET latitude = ${lat}, longitude = ${lng}, map_accuracy = 'manually_adjusted', updated_at = now() WHERE id = ${id}`.execute(this.need());
    await this.audit(ctx, tid, id, 'location_map_pin_changed', { lat, lng, source: 'super_admin' });
    return this.detail(id);
  }
}
