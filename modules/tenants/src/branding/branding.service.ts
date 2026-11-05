// branding.service.ts — platform branding source of truth on the backend. Returns the LOCKED default brand
// (mirrors brand/platform-brand.ts) merged with any super-admin colour/tagline overrides stored in
// platform_branding. The official LOGO asset is locked: replacing it is refused unless
// BRANDING_ALLOW_LOGO_REPLACE=true AND the actor holds branding.asset.upload. Raw SQL (no kysely.types edits).
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export const DEFAULT_BRANDING = {
  platform_name: 'AI PowerSalon',
  tagline: 'Smarter Salon. Stronger Business.',
  logo_full_url: '/brand/aipowersalon-logo.png',
  logo_mark_url: '/brand/aipowersalon-logo.png',
  favicon_url: '/brand/favicon.ico',
  app_icon_url: '/brand/app-icon-512.png',
  primary_color: '#A96F22',
  secondary_color: '#84561A',
  accent_color: '#C9971B',
  surface_color: '#FBF6EC',
  text_color: '#2A2118',
  logo_locked: true,
};
export type Branding = typeof DEFAULT_BRANDING & { updated_by?: string | null; updated_at?: string | null };

const COLOR_KEYS = ['platform_name','tagline','primary_color','secondary_color','accent_color','surface_color','text_color'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

export class BrandingError extends Error { constructor(public status: number, msg: string){ super(msg); } }

export class BrandingService {
  constructor(private readonly db: Kysely<DB> | null) {}

  /** Public, safe config consumed by every frontend. Never returns storage credentials. */
  async get(): Promise<Branding> {
    if (!this.db) return { ...DEFAULT_BRANDING };
    try {
      const r = await sql<any>`SELECT data, updated_by, updated_at FROM platform_branding WHERE id = 1`.execute(this.db);
      const row = r.rows[0];
      if (!row) return { ...DEFAULT_BRANDING };
      const ov = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
      // Logo URLs always come from the locked defaults — overrides cannot change them here.
      return { ...DEFAULT_BRANDING, ...ov,
        logo_full_url: DEFAULT_BRANDING.logo_full_url, logo_mark_url: DEFAULT_BRANDING.logo_mark_url,
        favicon_url: DEFAULT_BRANDING.favicon_url, app_icon_url: DEFAULT_BRANDING.app_icon_url, logo_locked: true,
        updated_by: row.updated_by ?? null, updated_at: row.updated_at ?? null };
    } catch { return { ...DEFAULT_BRANDING }; }
  }

  /** Super-admin colour/tagline update (logo NOT changeable here). Validates, persists, audits, invalidates. */
  async update(actor: { userId?: string; role?: string }, patch: Record<string, unknown>): Promise<Branding> {
    if (!this.db) throw new BrandingError(503, 'Branding store unavailable');
    const clean: Record<string, string> = {};
    for (const k of COLOR_KEYS) {
      if (patch[k] == null) continue;
      const v = String(patch[k]);
      if (k === 'platform_name' || k === 'tagline') clean[k] = v.slice(0, 80);
      else { if (!HEX.test(v)) throw new BrandingError(400, `${k} must be a #RRGGBB hex color`); clean[k] = v.toUpperCase(); }
    }
    if (Object.keys(clean).length === 0) throw new BrandingError(400, 'No valid branding fields to update');
    const cur = await this.get();
    const next = { ...cur, ...clean };
    delete (next as any).updated_by; delete (next as any).updated_at;
    await sql`
      INSERT INTO platform_branding (id, data, updated_by, updated_at) VALUES (1, ${JSON.stringify(next)}::jsonb, ${actor.userId ?? null}, now())
      ON CONFLICT (id) DO UPDATE SET data = ${JSON.stringify(next)}::jsonb, updated_by = ${actor.userId ?? null}, updated_at = now()
    `.execute(this.db);
    await this.audit(actor, 'platform_branding_updated', { changed: Object.keys(clean) });
    await this.audit(actor, 'branding_cache_invalidated', {});
    return this.get();
  }

  /** Restore platform branding to the locked defaults. */
  async restore(actor: { userId?: string; role?: string }): Promise<Branding> {
    if (!this.db) throw new BrandingError(503, 'Branding store unavailable');
    await sql`DELETE FROM platform_branding WHERE id = 1`.execute(this.db);
    await this.audit(actor, 'platform_logo_restored', {});
    return { ...DEFAULT_BRANDING };
  }

  /** Logo replacement is LOCKED. Refused unless an explicit env override + permission are present. */
  async replaceLogo(actor: { userId?: string; role?: string }, hasUploadPerm: boolean): Promise<never> {
    const allowed = String(process.env.BRANDING_ALLOW_LOGO_REPLACE || '').toLowerCase() === 'true';
    await this.audit(actor, 'platform_logo_upload_attempt', { allowed, hasUploadPerm });
    if (!allowed || !hasUploadPerm) {
      throw new BrandingError(423, 'The official AI PowerSalon logo is a locked brand asset and cannot be replaced.');
    }
    // Even when unlocked, asset upload must go through a reviewed pipeline — not implemented in-app by design.
    throw new BrandingError(501, 'Logo replacement requires the offline brand-asset pipeline (locked by policy).');
  }

  private async audit(actor: { userId?: string; role?: string }, action: string, meta: any) {
    if (!this.db) return;
    try {
      await sql`
        INSERT INTO audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
        VALUES (${actor.userId ?? null}, ${actor.role ?? null}, ${action}, 'platform_branding', 'platform', ${JSON.stringify(meta)}::jsonb)
      `.execute(this.db);
    } catch { /* best-effort */ }
  }
}
