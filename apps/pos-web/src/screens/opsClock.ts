// opsClock.ts — WP-C1 (Vietnamese POS mandate): a wall-clock time the server sends as "HH:MM" (the branch's own clock — no
// zone to convert) written in the user's language: "2:30 PM" in English, "14:30" in Vietnamese. Read at render.
import { currentLocale } from '@aipowersalon/mobile-sdk/i18n';

/** minutes since midnight → the user's clock */
export function clockOfMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  try { return new Intl.DateTimeFormat(currentLocale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, h, m)); }
  catch { return `${h}:${String(m).padStart(2, '0')}`; }
}

/** "14:30" (or an ISO string's time part) → the user's clock; anything else is returned as given */
export function clockOfHHMM(t: string | null | undefined): string {
  const hm = (t || '').includes('T') ? (String(t).split('T')[1] || '').slice(0, 5) : String(t || '');
  const m = /^(\d{1,2}):(\d{2})/.exec(hm);
  return m ? clockOfMinutes(Number(m[1]) * 60 + Number(m[2])) : String(t || '');
}
