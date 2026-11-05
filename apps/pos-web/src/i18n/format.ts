// format.ts — the POS display formatters by language (Vietnamese POS mandate §44–§48, WP-B; C-groups replace their
// hard-coded `toLocaleString('en-US')` with these).
//
// The convention (§47, recorded here so every screen follows the same one):
//   • LANGUAGE changes words only: month and weekday names, "AM/PM" wording → `currentLocale()` ('en-US' | 'vi-VN').
//   • The BRANCH time zone decides the clock (§46): an appointment at a New Jersey salon reads 3:05 PM on any register.
//     Set from GET pos/me/locale after sign-in (setBusinessTimeZone); the device zone until then.
//   • MONEY is the salon's currency in that currency's own notation (§45/§48): a US salon shows "$1,234.56" in English AND
//     in Vietnamese — never "1.234,56 US$", which a cashier could misread by a factor of a thousand. The language never
//     changes the currency, the amount, the rounding or the separators. Plain counts use the same grouping.
// Formatters are pure functions of (value, language, zone, currency) and are called at render, so a language switch
// re-formats in place.
import { currentLocale, businessTimeZone, fmtDate as sdkDate, fmtMonthDay as sdkMonthDay, fmtTime as sdkTime, fmtDateTime as sdkDateTime, fmtInZone as sdkInZone, fmtYmd as sdkYmd } from '@aipowersalon/mobile-sdk/i18n';

let currency = 'USD';
/** The salon's currency (tenant configuration). The language never sets it. */
export function setTenantCurrency(code: string | null | undefined): void { if (code && /^[A-Z]{3}$/.test(code)) currency = code; }
export function tenantCurrency(): string { return currency; }
/** The notation of the salon's currency (USD → en-US grouping), independent of the POS language. */
const MONEY_LOCALE: Record<string, string> = { USD: 'en-US', CAD: 'en-CA', VND: 'vi-VN', EUR: 'de-DE', GBP: 'en-GB', AUD: 'en-AU' };
function moneyLocale(): string { return MONEY_LOCALE[currency] ?? 'en-US'; }

/** Integer cents → "$1,234.56" (sign first: "−$6.75"). `whole` drops the cents ("$1,235"). Never changes with language. */
export function fmtMoney(cents: number | null | undefined, o: { whole?: boolean } = {}): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '—';
  const f = new Intl.NumberFormat(moneyLocale(), { style: 'currency', currency, minimumFractionDigits: o.whole ? 0 : 2, maximumFractionDigits: o.whole ? 0 : 2 });
  const s = f.format(Math.abs(n) / 100);
  return n < 0 && Math.round(Math.abs(n)) > 0 ? '−' + s : s;
}
/** Integer cents → a compact amount in the salon's currency notation ("$12K", "$2.45M") for a small KPI tile or chart
 *  centre (Overview mandate §10); below `from` cents it is the whole-dollar fmtMoney. Never changes with language. */
export function fmtMoneyCompact(cents: number | null | undefined, from = 10000000, maxFractionDigits = 2): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < from) return fmtMoney(n, { whole: true });
  const s = new Intl.NumberFormat(moneyLocale(), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: maxFractionDigits }).format(Math.abs(n) / 100);
  return n < 0 ? '−' + s : s;
}
/** A count / quantity with the salon's grouping ("1,234"). */
export function fmtNumber(n: number | null | undefined, maxFractionDigits = 0): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString(moneyLocale(), { maximumFractionDigits: maxFractionDigits }) : '—';
}

type X = string | number | Date | null | undefined;
/** "Oct 9, 2026" / "9 thg 10, 2026" — branch zone, language words. */
export const fmtDate = (x: X): string => sdkDate(x);
/** "Oct 9" / "9 thg 10" */
export const fmtMonthDay = (x: X): string => sdkMonthDay(x);
/** "3:05 PM" / "3:05 CH" */
export const fmtTime = (x: X): string => sdkTime(x);
/** "Oct 9, 3:05 PM" */
export const fmtDateTime = (x: X): string => sdkDateTime(x);
/** Any Intl date options, branch zone, language words. */
export const fmtInZone = (x: X, opts: Intl.DateTimeFormatOptions): string => sdkInZone(x, opts);
/** A calendar day 'YYYY-MM-DD' (never shifted by a zone). */
export const fmtYmd = (ymd: string | null | undefined, opts?: Intl.DateTimeFormatOptions, fallback = ''): string => sdkYmd(ymd, opts, fallback);
/** For screens that build their own Intl formatter: the words locale and the branch zone. */
export function displayLocale(): string { return currentLocale(); }
export function displayTimeZone(): string | undefined { return businessTimeZone(); }
