// bkpi.en.ts — Booking KPI strip (booking200 addendum §08, round 12): screens/booking/BookingKpiStrip.tsx. Keys: `bkpi.*`.
// Card titles reuse the existing pos.* labels (Appointments, Arriving soon, Walk-ins, Waitlist, Available now, Booked revenue).
export const BKPI_EN: Record<string, string> = {
  "bkpi.region": "Booking summary",
  "bkpi.loading": "Loading…",
  "bkpi.notToday": "Today only",
  "bkpi.liveTodayOnly": "Live — today only",
  "bkpi.unavailable": "Could not load — not zero",
  "bkpi.stale": "Showing the last loaded numbers — could not refresh",
  "bkpi.retry": "Retry",
  "bkpi.appointments.sub": "{awaiting} awaiting confirmation · {confirmed} confirmed",
  "bkpi.appointments.subShort": "Booked for this day",
  "bkpi.arriving.sub": "Next {minutes} min",
  "bkpi.arriving.window": "Arriving-soon window",
  "bkpi.arriving.minutes": "{minutes} min",
  "bkpi.walkins.sub": "{booked} booked · {queue} from queue",
  "bkpi.waitlist.sub": "Waiting in Customer Queue",
  "bkpi.available.sub": "{working} working today",
  "bkpi.available.otherDay": "{working} scheduled that day",
  "bkpi.revenue.sub": "Booked services · not collected",
  "bkpi.revenue.basis": "Service prices on this day's booked appointments (cancelled and no-show excluded). Excludes tax, tips, surcharges and discounts. Not money collected.",
  "bkpi.open": "Open the filtered list",
};
