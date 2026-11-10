// saved-views.ts — POS saved views (Kevin, Nov 9 2026: the SUNMI guides' optional "Saved Views" / "Smart Filter Presets" /
// "Saved Filters"). One person's named filters for one POS screen, inside one salon (migration 844).
//
// Safety: a view stores filter VALUES only and every read / write is keyed by (tenant_id, owner_user_id) taken from the
// session — never from the body — so nobody can read or change another person's views, in this salon or another. Opening
// a view re-runs the screen's own query under the person's current permissions, so a view never widens access.
import { HttpException, HttpStatus } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { SAVED_VIEW_LIMITS, SAVED_VIEW_SURFACE, checkSavedViewFilters, type SavedView, type SavedViewList } from '@aipowersalon/api-contracts/tenant';

export type ViewCtx = { tenantId?: string; userId?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (msg: string) => withCode(new HttpException(msg, HttpStatus.BAD_REQUEST), 'SAVED_VIEW_INVALID');
const notFound = () => withCode(new HttpException('That saved view no longer exists.', HttpStatus.NOT_FOUND), 'SAVED_VIEW_NOT_FOUND');
type Row = { id: string; surface: string; name: string; filters_json: unknown; is_default: boolean; updated_at: Date };
const toView = (r: Row): SavedView => ({ id: String(r.id), surface: r.surface, name: r.name, filters: (r.filters_json ?? {}) as SavedView['filters'], isDefault: !!r.is_default, updatedAt: new Date(r.updated_at).toISOString() });

function who(ctx: ViewCtx): { t: string; u: string } {
  if (!ctx.tenantId || !ctx.userId || !UUID.test(ctx.userId)) throw withCode(new HttpException('Sign in again to use saved views.', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  return { t: ctx.tenantId, u: ctx.userId };
}
function surfaceOf(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!SAVED_VIEW_SURFACE.test(s)) throw bad('Unknown screen for a saved view.');
  return s;
}
function nameOf(v: unknown): string {
  const n = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > SAVED_VIEW_LIMITS.nameLength) throw bad(`Give the view a name of 1–${SAVED_VIEW_LIMITS.nameLength} characters.`);
  return n;
}
function filtersOf(v: unknown) {
  const r = checkSavedViewFilters(v);
  if (!r.ok) throw bad(`Those filters cannot be saved (${r.reason}).`);
  return r.value;
}
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';

export class SavedViews {
  constructor(private readonly db: Kysely<DB> | null) {}

  async list(ctx: ViewCtx, surface: unknown): Promise<SavedViewList> {
    const s = surfaceOf(surface);
    if (!this.db) return { surface: s, items: [], limit: SAVED_VIEW_LIMITS.perSurface };
    const { t, u } = who(ctx);
    const rows = await sql<Row>`SELECT id, surface, name, filters_json, is_default, updated_at FROM pos_saved_views
       WHERE tenant_id = ${t}::uuid AND owner_user_id = ${u}::uuid AND surface = ${s}
       ORDER BY is_default DESC, lower(name), id`.execute(this.db);
    return { surface: s, items: rows.rows.map(toView), limit: SAVED_VIEW_LIMITS.perSurface };
  }

  async create(ctx: ViewCtx, body: { surface?: unknown; name?: unknown; filters?: unknown; isDefault?: unknown }): Promise<SavedView> {
    if (!this.db) throw withCode(new HttpException('Saved views are unavailable right now.', HttpStatus.SERVICE_UNAVAILABLE), 'SERVICE_UNAVAILABLE');
    const { t, u } = who(ctx);
    const s = surfaceOf(body?.surface), name = nameOf(body?.name), filters = filtersOf(body?.filters), def = body?.isDefault === true;
    try {
      return await this.db.transaction().execute(async (tx) => {
        // one writer per person + screen at a time, so the 20-view limit and the single default hold under double taps
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`saved-view:${t}:${u}:${s}`}))`.execute(tx);
        const n = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM pos_saved_views WHERE tenant_id = ${t}::uuid AND owner_user_id = ${u}::uuid AND surface = ${s}`.execute(tx)).rows[0]?.n ?? 0);
        if (n >= SAVED_VIEW_LIMITS.perSurface) throw withCode(new HttpException(`You already have ${SAVED_VIEW_LIMITS.perSurface} saved views on this screen — delete one first.`, HttpStatus.CONFLICT), 'SAVED_VIEW_LIMIT');
        if (def) await sql`UPDATE pos_saved_views SET is_default = false, updated_at = now(), updated_by = ${u}::uuid WHERE tenant_id = ${t}::uuid AND owner_user_id = ${u}::uuid AND surface = ${s} AND is_default`.execute(tx);
        const r = await sql<Row>`INSERT INTO pos_saved_views (tenant_id, owner_user_id, surface, name, filters_json, is_default, updated_by)
           VALUES (${t}::uuid, ${u}::uuid, ${s}, ${name}, ${JSON.stringify(filters)}::jsonb, ${def}, ${u}::uuid)
           RETURNING id, surface, name, filters_json, is_default, updated_at`.execute(tx);
        return toView(r.rows[0]);
      });
    } catch (e) {
      if (isUnique(e)) throw withCode(new HttpException('You already have a saved view with that name on this screen.', HttpStatus.CONFLICT), 'SAVED_VIEW_NAME_TAKEN');
      throw e;
    }
  }

  async update(ctx: ViewCtx, id: string, body: { name?: unknown; filters?: unknown; isDefault?: unknown }): Promise<SavedView> {
    if (!this.db) throw notFound();
    const { t, u } = who(ctx);
    if (!UUID.test(String(id))) throw notFound();
    const name = body?.name !== undefined ? nameOf(body.name) : null;
    const filters = body?.filters !== undefined ? filtersOf(body.filters) : null;
    const def = body?.isDefault === undefined || body?.isDefault === null ? null : body.isDefault === true;
    try {
      return await this.db.transaction().execute(async (tx) => {
        const cur = (await sql<Row>`SELECT id, surface, name, filters_json, is_default, updated_at FROM pos_saved_views
           WHERE id = ${id}::uuid AND tenant_id = ${t}::uuid AND owner_user_id = ${u}::uuid FOR UPDATE`.execute(tx)).rows[0];
        if (!cur) throw notFound();
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`saved-view:${t}:${u}:${cur.surface}`}))`.execute(tx);
        if (def === true) await sql`UPDATE pos_saved_views SET is_default = false, updated_at = now(), updated_by = ${u}::uuid WHERE tenant_id = ${t}::uuid AND owner_user_id = ${u}::uuid AND surface = ${cur.surface} AND is_default AND id <> ${id}::uuid`.execute(tx);
        const r = await sql<Row>`UPDATE pos_saved_views SET
             name = ${name ?? cur.name},
             filters_json = ${filters ? JSON.stringify(filters) : JSON.stringify(cur.filters_json ?? {})}::jsonb,
             is_default = ${def ?? cur.is_default}, updated_at = now(), updated_by = ${u}::uuid
           WHERE id = ${id}::uuid AND tenant_id = ${t}::uuid AND owner_user_id = ${u}::uuid
           RETURNING id, surface, name, filters_json, is_default, updated_at`.execute(tx);
        return toView(r.rows[0]);
      });
    } catch (e) {
      if (isUnique(e)) throw withCode(new HttpException('You already have a saved view with that name on this screen.', HttpStatus.CONFLICT), 'SAVED_VIEW_NAME_TAKEN');
      throw e;
    }
  }

  async remove(ctx: ViewCtx, id: string): Promise<{ deleted: true }> {
    if (!this.db) throw notFound();
    const { t, u } = who(ctx);
    if (!UUID.test(String(id))) throw notFound();
    const r = await sql`DELETE FROM pos_saved_views WHERE id = ${id}::uuid AND tenant_id = ${t}::uuid AND owner_user_id = ${u}::uuid`.execute(this.db);
    if (!Number(r.numAffectedRows ?? 0)) throw notFound();
    return { deleted: true };
  }
}
