// deviceToday.ts — this POS device's calendar day as 'YYYY-MM-DD'. `new Date().toISOString().slice(0, 10)` is the UTC day: after
// 7–8 PM Eastern it is already tomorrow, so date fields, "today" presets and calendars jumped a day ahead in the evening.
// Screens use the server's salon-local `today` when they have it; this is the fallback (the device sits in the salon).
export function deviceToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
