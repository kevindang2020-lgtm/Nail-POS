import { foldVi } from './text/vi-fold';
// language.ts — Constitution 6 §97–98 (BUILD_PLAN Phase 13, E; audit bug 11): the app languages and the per-user
// preference wire shape. English is the default and the fallback for every missing translation.
export const APP_LANGUAGES = ['en', 'vi'] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: AppLanguage = 'en';
export function isAppLanguage(v: unknown): v is AppLanguage { return typeof v === 'string' && (APP_LANGUAGES as readonly string[]).includes(v); }
/** BCP-47 locale used for number / date display in each language (business time zone and currency stay the branch's). */
export const LANGUAGE_LOCALE: Record<AppLanguage, string> = { en: 'en-US', vi: 'vi-VN' };
/** PUT {customer|owner|tech|pos}/me/language → the saved choice. `language` null = never chosen (the app follows the device). */
export interface UserLanguagePreference { language: AppLanguage | null }
/** GET {customer|owner|tech|pos}/me/locale — the user's language and the BUSINESS time zone the app formats dates in
 *  (§99: the session branch's zone, else the salon's first branch; null when the session has no salon → device zone). */
export interface UserLocaleContext extends UserLanguagePreference { timeZone: string | null }
export interface SetUserLanguageBody { language: AppLanguage }
/** Each language's name written in that language — the standard way a language picker is labelled (WP-B). */
export const LANGUAGE_NAME: Record<AppLanguage, string> = { en: 'English', vi: 'Tiếng Việt' };

/** Vietnamese POS mandate WP-A (§93): GET / PUT super-admin/tenants/:tenantId/pos-language — the salon's DEFAULT POS
 *  language (authority: tenant_settings business-branch salon-wide `defaultLanguage`, migration 695). `language` null =
 *  never set → the POS shows English (`effective`). Staff who chose their own language keep it: `staffWithOwnChoice`
 *  counts them so the Super Admin can see who a change will NOT affect. */
export interface TenantPosLanguage {
  tenantId: string;
  language: AppLanguage | null;
  effective: AppLanguage;
  staffWithOwnChoice: { en: number; vi: number };
  updatedAt: string | null;
}
export interface SetTenantPosLanguageBody { language: AppLanguage; reason?: string | null }

// ── Customer communication language (English + Vietnamese POS mandate WP-I, §54–§55, §118–§119) ─────────────────────────
// customers.preferred_language ('en' / 'vi' since migration 697) is still stored and validated, but since Kevin's ruling of
// Oct 28 2026 it no longer changes what customers receive: every customer message is English (customerMessageLanguage).
const CUSTOMER_VI = new Set(['vi', 'vi-vn', 'vi_vn', 'vn', 'viet', 'vietnamese', 'vietnam', 'viet nam', 'tieng viet']);
const CUSTOMER_EN = new Set(['en', 'en-us', 'en_us', 'en-gb', 'en_gb', 'en-ca', 'en-au', 'eng', 'english', 'tieng anh']);
/** A customer-language value as staff may type it ("Vietnamese", "Tiếng Việt", "vi-VN", "English") → 'en' / 'vi';
 *  empty → null (no preference); anything else → undefined (not a language the salon writes in — the caller refuses it).
 *  The SQL twin is migration 697's mapping (vi_fold + the same lists). */
export function normalizeCustomerLanguage(v: unknown): AppLanguage | null | undefined {
  if (v == null) return null;
  if (typeof v !== 'string') return undefined;
  const k = foldVi(v).replace(/\s+/g, ' ').trim();
  if (!k) return null;
  if (CUSTOMER_VI.has(k)) return 'vi';
  if (CUSTOMER_EN.has(k)) return 'en';
  return undefined;
}
/**
 * The language every automated message to a CUSTOMER is written in — reminders, receipts, booking / reschedule / cancel /
 * check-in / bill / payment notices, the phone-change text, AI reschedule offers, review requests.
 *
 * Kevin's ruling (Oct 28 2026): the salons' customers are American, English-speaking customers — every customer message is
 * ENGLISH, whatever language is stored on the customer record and whatever the salon's or the staff member's POS language.
 * Vietnamese is for the salon's STAFF screens (the POS), not for customers. The parameters are kept so the call sites do not
 * change; the Vietnamese customer wording stays in the code unused, so turning it back on later is one line here.
 */
export function customerMessageLanguage(_customerPreference?: unknown, _salonDefault?: unknown): AppLanguage {
  return DEFAULT_LANGUAGE;   // 'en'
}

// ── POS-only Vietnamese (POSLanguage.pdf, Oct 28 2026 — the authoritative language-scope mandate) ─────────────────────────
/** Every application the platform ships. Only the employee Front Desk POS is bilingual. */
export type ApplicationId =
  | 'FRONT_DESK_POS' | 'CUSTOMER_APP' | 'TECHNICIAN_APP' | 'OWNER_APP' | 'TAP_TO_PAY_APP' | 'SUPER_ADMIN'
  | 'ONLINE_BOOKING' | 'CUSTOMER_DISPLAY' | 'CHECK_IN_KIOSK' | 'AI_VOICE_RECEPTIONIST';
/**
 * §1 / §20: the languages each application may show. HARD BOUNDARY: the Front Desk POS = English + Tiếng Việt; every other
 * application and every system-generated customer surface = English only. Each app applies its row at bootstrap
 * (setLanguagePolicy in @aipowersalon/mobile-sdk/i18n); a POS language choice NEVER changes another application's language.
 */
export const APPLICATION_LOCALE_POLICY: Readonly<Record<ApplicationId, readonly AppLanguage[]>> = Object.freeze({
  FRONT_DESK_POS: ['en', 'vi'],
  CUSTOMER_APP: ['en'],
  TECHNICIAN_APP: ['en'],
  OWNER_APP: ['en'],
  TAP_TO_PAY_APP: ['en'],
  SUPER_ADMIN: ['en'],
  ONLINE_BOOKING: ['en'],
  CUSTOMER_DISPLAY: ['en'],
  CHECK_IN_KIOSK: ['en'],
  AI_VOICE_RECEPTIONIST: ['en'],   // Kevin, Oct 28 2026: the AI phone receptionist speaks English only (§18)
});
/** The AI phone receptionist's spoken language (BCP-47) — always English, whatever a setting, an agent row or a request says. */
export const VOICE_RECEPTIONIST_LOCALE = 'en-US';
/** §7: the Front Desk POS language — the person's POS choice, else the salon's Default POS Language, else English. */
export function resolveFrontDeskPosLocale(o: { userPosLocale?: unknown; tenantDefaultPosLocale?: unknown }): AppLanguage {
  if (isAppLanguage(o.userPosLocale)) return o.userPosLocale;
  if (isAppLanguage(o.tenantDefaultPosLocale)) return o.tenantDefaultPosLocale;
  return DEFAULT_LANGUAGE;
}
/** §7 / §20: any other application's language — whatever is asked, stored, or detected on the device. */
export function resolveApplicationLocale(app: ApplicationId, wanted?: unknown): AppLanguage {
  const allowed = APPLICATION_LOCALE_POLICY[app] ?? [DEFAULT_LANGUAGE];
  return isAppLanguage(wanted) && allowed.includes(wanted) ? wanted : DEFAULT_LANGUAGE;
}
