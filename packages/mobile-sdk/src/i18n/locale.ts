// locale.ts — Constitution 6 §98–99 (BUILD_PLAN Phase 13, E): the signed-in user's locale context and the BUSINESS
// formatters the mobile screens use.
//
// Language follows the user (server-saved); dates follow the BRANCH: an appointment at a New Jersey salon reads 3:05 PM
// on a phone in California. The zone comes from GET {realm}/me/locale (the session branch, else the salon's first branch).
// Until it is known (signed out, offline) the formatters use the device zone — exactly what the replaced local formatters
// did, so nothing changes for a phone that is already in the salon's zone.
import type { AppLanguage, UserLocaleContext } from '@aipowersalon/api-contracts';
import { formatShortDate, formatMonthDay, formatTimeOfDay, formatMonthDayTime, formatYmd, formatInZone } from '@aipowersalon/date-time';
import { initLanguage, currentLocale } from './i18n';

let zone: string | undefined;

export function setBusinessTimeZone(tz: string | null | undefined): void { zone = tz || undefined; }
export function businessTimeZone(): string | undefined { return zone; }
/** The zone to compute "today" / "tomorrow" in: the branch's, else the device's. */
export function effectiveTimeZone(): string {
  if (zone) return zone;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** After sign-in (and after a branch switch): apply the user's saved language and the branch's zone. Never throws. */
export async function syncUserLocale(load: () => Promise<UserLocaleContext | null | undefined>, device?: string | null): Promise<AppLanguage> {
  let ctx: UserLocaleContext | null | undefined = null;
  try { ctx = await load(); } catch { ctx = null; }
  if (ctx?.timeZone) setBusinessTimeZone(ctx.timeZone);
  return initLanguage({ device, load: async () => (ctx ? { language: ctx.language } : null) });
}

type X = string | number | Date | null | undefined;
/** "Oct 9, 2026" in the branch zone */
export const fmtDate = (x: X) => formatShortDate(x, zone, currentLocale());
/** "Oct 9" in the branch zone */
export const fmtMonthDay = (x: X) => formatMonthDay(x, zone, currentLocale());
/** "3:05 PM" in the branch zone */
export const fmtTime = (x: X) => formatTimeOfDay(x, zone, currentLocale());
/** "Oct 9, 3:05 PM" in the branch zone */
export const fmtDateTime = (x: X) => formatMonthDayTime(x, zone, currentLocale());
/** Any Intl options in the branch zone. */
export const fmtInZone = (x: X, opts: Intl.DateTimeFormatOptions) => formatInZone(x, opts, zone, currentLocale());
/** A calendar date ('YYYY-MM-DD') — never shifted. */
export const fmtYmd = (ymd: string | null | undefined, opts?: Intl.DateTimeFormatOptions, fallback = '') => formatYmd(ymd, opts, currentLocale(), fallback);

export function resetLocaleForTests(): void { zone = undefined; }
