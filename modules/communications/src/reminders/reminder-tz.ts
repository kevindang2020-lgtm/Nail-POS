// reminder-tz.ts — convert a salon-local appointment date + time (no tz) to an absolute epoch (ms), honoring the
// tenant's IANA timezone including DST. Pure (uses the built-in Intl database; no external dependency).
// Offset (ms) of `tz` from UTC at the given instant.
// Thin adapter over @aipowersalon/date-time (Constitution 13 §87): the two-pass DST resolution and the en-CA day
// formatting now live there, unchanged. Exported names kept so reminders.service is untouched.
export { localDateTimeToEpochMs, epochToLocalDate } from '@aipowersalon/date-time';
