// salon-logo.ts — the salon's own logo: ONE stored image used on its receipts and at the top of its customer display
// (23-inch dual-screen spec §13: "Salon Logo … do not permanently hard-code AI PowerSalon as the salon identity").
//
// Until Oct 2026 the Receipts & Branding "logo upload" kept a data URL in a process-memory Map: it vanished on every
// restart, was invisible to a second API instance, and nothing ever showed it. Now:
//   • the BYTES decide — a PNG, JPEG or WebP by its header (never SVG, which can carry script), its real dimensions read
//     from the header, a size cap — so a script renamed .png is refused (@aipowersalon/media image-info);
//   • the file lands in the public media store (it is shown on a customer-facing screen — public by design), under a key
//     scoped to the salon with a random token and the SNIFFED extension;
//   • its key and URL live in the salon's own settings row (tenant_settings, category 'salon-logo', salon-wide). That row
//     is written ONLY here — it is not a POS settings category, so the generic settings PATCH can never point the logo at
//     an address of someone else's choosing.
import { KIND_EXT, KIND_MIME, imageInfo, orientedSize, sniffImage, type ImageKind } from '@aipowersalon/media';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export const SALON_LOGO_CATEGORY = 'salon-logo';
/** Logos are small: the POS shrinks the picture to fit 800 px before uploading; these are the server's hard limits. */
export const SALON_LOGO_RULES = Object.freeze({ maxBytes: 1_000_000, minEdge: 32, maxEdge: 2048 });

export interface SalonLogo { key: string; url: string; mime: string; width: number; height: number; bytes: number; updatedAt: string }

export class SalonLogoError extends Error { constructor(message: string) { super(message); this.name = 'ValidationError'; } }

export interface CheckedLogo { buf: Buffer; kind: ImageKind; mime: string; ext: string; width: number; height: number }

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/** A `data:image/…;base64,…` upload → the checked image, or a SalonLogoError saying what is wrong with it. */
export function checkLogoDataUrl(input: unknown, rules = SALON_LOGO_RULES): CheckedLogo {
  if (typeof input !== 'string' || !input) throw withCode(new SalonLogoError('Choose a logo image to upload.'), 'LOGO_FILE_REQUIRED');
  // the base64 of the size cap, plus the header — refuse a giant string before decoding it
  if (input.length > Math.ceil(rules.maxBytes * 4 / 3) + 128) throw withCode(new SalonLogoError(`The logo is larger than ${Math.round(rules.maxBytes / 1000)} KB.`), 'LOGO_TOO_LARGE', { maxKb: Math.round(rules.maxBytes / 1000) });
  const m = DATA_URL.exec(input.trim());
  if (!m) throw withCode(new SalonLogoError('Upload the logo as a PNG, JPEG or WebP image.'), 'LOGO_TYPE_INVALID');
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (buf.length === 0) throw withCode(new SalonLogoError('The logo file is empty.'), 'LOGO_UNREADABLE');
  if (buf.length > rules.maxBytes) throw withCode(new SalonLogoError(`The logo is larger than ${Math.round(rules.maxBytes / 1000)} KB.`), 'LOGO_TOO_LARGE', { maxKb: Math.round(rules.maxBytes / 1000) });
  const kind = sniffImage(buf);
  if (!kind) throw withCode(new SalonLogoError('Only PNG, JPEG or WebP images can be used as the logo.'), 'LOGO_TYPE_INVALID');
  const declared = m[1].toLowerCase().replace(/^image\/jpg$/, 'image/jpeg');
  if (declared !== KIND_MIME[kind]) throw withCode(new SalonLogoError('The file type does not match the file contents.'), 'LOGO_TYPE_INVALID');
  const info = imageInfo(buf, kind);
  if (!info) throw withCode(new SalonLogoError('The logo image could not be read.'), 'LOGO_UNREADABLE');
  const { width, height } = orientedSize(info);
  if (Math.max(width, height) > rules.maxEdge) throw withCode(new SalonLogoError(`The logo is too large (${width}×${height}). Keep it under ${rules.maxEdge} pixels per side.`), 'LOGO_DIMENSIONS_TOO_LARGE', { max: rules.maxEdge });
  if (Math.min(width, height) < rules.minEdge) throw withCode(new SalonLogoError(`The logo is too small (${width}×${height}). Use at least ${rules.minEdge} pixels per side.`), 'LOGO_DIMENSIONS_TOO_SMALL', { min: rules.minEdge });
  return { buf, kind, mime: KIND_MIME[kind], ext: KIND_EXT[kind], width, height };
}

const UUIDISH = /^[0-9a-zA-Z_-]{1,64}$/;
/** The storage key: scoped to the salon, a random token (a replaced logo's address is never reused), the sniffed type. */
export function salonLogoKey(tenantId: string, token: string, ext: string): string {
  if (!UUIDISH.test(tenantId) || !/^[0-9a-f]{24}$/.test(token) || !/^(png|jpg|webp)$/.test(ext)) throw new SalonLogoError('Invalid logo key.');
  return `salon-logos/${tenantId}/logo-${token}.${ext}`;
}
/** True only for a key this service would have written for that salon. */
export function isSalonLogoKey(tenantId: string, key: unknown): key is string {
  return typeof key === 'string' && UUIDISH.test(tenantId) && new RegExp(`^salon-logos/${tenantId}/logo-[0-9a-f]{24}\\.(png|jpg|webp)$`).test(key);
}
/** The logo's public address as the display should load it — or null for anything that is not this salon's stored logo
 *  (local store: exactly /media/<key>; object store/CDN: an https address ending in /<key>). */
export function safeSalonLogoUrl(tenantId: string, logo: { key?: unknown; url?: unknown } | null | undefined): string | null {
  if (!logo || !isSalonLogoKey(tenantId, logo.key) || typeof logo.url !== 'string') return null;
  const key = logo.key as string;
  if (logo.url === `/media/${key}`) return logo.url;
  if (/^https:\/\/[^\s"'<>]+$/.test(logo.url) && logo.url.endsWith(`/${key}`)) return logo.url;
  return null;
}

// ── persistence: the salon-wide row of tenant_settings, category 'salon-logo' ─────────────────────────────────────────
export interface SalonLogoStore {
  get(tenantId: string): Promise<SalonLogo | null>;
  /** Saves the new logo; returns the one it replaced (its file is then removed by the caller). */
  put(tenantId: string, logo: SalonLogo, userId: string | null): Promise<SalonLogo | null>;
  /** Removes the logo; returns what was there. */
  clear(tenantId: string): Promise<SalonLogo | null>;
}

export function parseSalonLogo(tenantId: string, j: unknown): SalonLogo | null {
  let o: any = j;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== 'object' || !isSalonLogoKey(tenantId, o.key) || typeof o.url !== 'string') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { key: o.key, url: o.url, mime: String(o.mime ?? ''), width: num(o.width), height: num(o.height), bytes: num(o.bytes), updatedAt: String(o.updatedAt ?? '') };
}

export class InMemorySalonLogoStore implements SalonLogoStore {
  private readonly rows = new Map<string, SalonLogo>();
  async get(tenantId: string) { return this.rows.get(tenantId) ?? null; }
  async put(tenantId: string, logo: SalonLogo) { const prev = this.rows.get(tenantId) ?? null; this.rows.set(tenantId, { ...logo }); return prev; }
  async clear(tenantId: string) { const prev = this.rows.get(tenantId) ?? null; this.rows.delete(tenantId); return prev; }
}

const uuidOrNull = (v: string | null) => (v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);

export class KyselySalonLogoStore implements SalonLogoStore {
  constructor(private readonly db: Kysely<DB>) {}

  async get(tenantId: string): Promise<SalonLogo | null> {
    const r = await this.db.selectFrom('tenant_settings').select('settings_json')
      .where('tenant_id', '=', tenantId).where('category', '=', SALON_LOGO_CATEGORY).where('branch_id', 'is', null)
      .executeTakeFirst();
    return r ? parseSalonLogo(tenantId, r.settings_json) : null;
  }

  async put(tenantId: string, logo: SalonLogo, userId: string | null): Promise<SalonLogo | null> {
    return this.db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('tenant_settings').select('settings_json')
        .where('tenant_id', '=', tenantId).where('category', '=', SALON_LOGO_CATEGORY).where('branch_id', 'is', null)
        .forUpdate().executeTakeFirst();
      const json = JSON.stringify(logo);
      await sql`INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id)
                VALUES (${tenantId}, NULL, ${SALON_LOGO_CATEGORY}, ${json}::jsonb, ${uuidOrNull(userId)})
                ON CONFLICT (tenant_id, category) WHERE branch_id IS NULL
                DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`.execute(trx);
      return cur ? parseSalonLogo(tenantId, cur.settings_json) : null;
    });
  }

  async clear(tenantId: string): Promise<SalonLogo | null> {
    const r = await this.db.deleteFrom('tenant_settings')
      .where('tenant_id', '=', tenantId).where('category', '=', SALON_LOGO_CATEGORY).where('branch_id', 'is', null)
      .returning('settings_json').executeTakeFirst();
    return r ? parseSalonLogo(tenantId, r.settings_json) : null;
  }
}
