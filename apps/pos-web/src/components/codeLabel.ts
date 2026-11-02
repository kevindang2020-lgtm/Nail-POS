// codeLabel.ts — Vietnamese POS mandate WP-C4: the display label for a code that a WP-C4 screen owns (a sign-in event type,
// a device kind, an approval reason …) and that ns/status does not carry. Looks up `<prefix>.<code>` in the catalogue
// (ns/admin), then the canonical status domains (statusLabel), and never shows a blank or a raw key — an unknown code is
// humanised ("PIN_UNLOCK_FAILED" → "Pin unlock failed"). Call it at RENDER time (a language switch re-labels in place).
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { displayLocale } from '../i18n/format';

export function codeLabel(prefix: string, code: string | null | undefined, statusDomains: string | readonly string[] = []): string {
  if (code == null || code === '') return '';
  const key = `${prefix}.${code}`;
  const text = t(key);
  return text !== key ? text : statusLabel(statusDomains, code);
}

/** 0 = Sunday … 6 = Saturday → the approved short day name ("Sun" / "CN", "Mon" / "T2" …), read at render */
const WEEKDAY_KEYS = ['pos.sun', 'pos.mon', 'pos.tue', 'pos.wed', 'pos.thu', 'pos.fri', 'pos.sat'] as const;
export const weekdayShort = (d: number): string => (WEEKDAY_KEYS[d] ? t(WEEKDAY_KEYS[d]) : String(d));

/** a wall-clock 'HH:MM' (no date, no zone) → "3:05 PM" in English, "15:05" in Vietnamese (the 24-hour clock Vietnamese
 *  screens use); never shifted by a time zone. Written by hand — ICU's AM/PM spacing differs between runtimes. */
export function fmtClock(hhmm: string | null | undefined): string {
  const [h, m] = String(hhmm ?? '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm ?? '');
  const mm = String(m).padStart(2, '0');
  if (displayLocale().toLowerCase().startsWith('vi')) return `${String(h).padStart(2, '0')}:${mm}`;
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "12s ago" / "5 min ago" / "3 h ago" / "2 days ago" in the POS language (an ISO time; '—' when there is none) */
export function agoLabel(iso: string | null | undefined, nowMs = Date.now()): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '—';
  const s = Math.max(0, Math.floor((nowMs - at) / 1000));
  if (s < 60) return t('pos.s_s_ago', { s: String(s) });
  if (s < 3600) return t('pos.v0_min_ago', { v0: String(Math.floor(s / 60)) });
  if (s < 86400) return t('pos.v0_h_ago', { v0: String(Math.floor(s / 3600)) });
  const days = Math.floor(s / 86400);
  return days === 1 ? t('pos.1_day_ago') : t('admin.account.daysAgo', { days: String(days) });
}

/** an audit event's action code ("payment.refunded", "owner_branch_selected") → admin.audit.action.<code>, else the code
 *  humanised ("Payment Refunded"); empty → "Event". The audit vocabulary is open-ended, so the humanised form is the fallback. */
export function auditActionLabel(action: string | null | undefined): string {
  const code = String(action ?? '').trim();
  if (!code) return t('pos.event');
  const k = `admin.audit.action.${code}`;
  const l = t(k);
  return l !== k ? l : code.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
/** an audit module code ("checkout") → admin.audit.module.<code>, else humanised; empty → "—" */
export const auditModuleLabel = (m: string | null | undefined): string => (m ? codeLabel('admin.audit.module', m) : '—');

/** 0 = January … 11 = December → the month's name in the POS language ("January" / "tháng 1") */
export const monthLong = (i: number): string => new Intl.DateTimeFormat(displayLocale(), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 1)));
