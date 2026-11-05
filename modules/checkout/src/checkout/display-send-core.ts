// display-send-core.ts — 23-inch dual-screen spec §9–§11, §82–§83: WHICH customer display a checkout goes to. Pure.
//
//   Switch Display (a display named) ── exactly that one, if it is usable
//   Send to Display (none named) ────── the display this checkout is already on, else the display DEDICATED to this POS's
//                                       register, then the branch's SHARED displays — online ones only (§83: an offline
//                                       display never stops a checkout; the POS carries on and says so)
//   never ──────────────────────────── another register's dedicated display, a display in maintenance, an offline one
//
// The candidates come back in order; the caller reserves the first one that is free (another customer on it is
// DISPLAY_BUSY, §11 — the next shared display is tried, and the customer on the busy one is never displaced).

export interface DisplayCandidate { deviceId: string; label: string; stationId: string | null; online: boolean; maintenance: boolean }
export type DisplayPick =
  | { ok: true; order: DisplayCandidate[] }
  | { ok: false; reason: 'no_display' | 'no_display_for_register' | 'not_found' | 'maintenance' | 'offline'; message: string };

const name = (d: DisplayCandidate): string => d.label || 'The customer display';

export function pickDisplays(
  devices: DisplayCandidate[],
  want: { stationId?: string | null; deviceId?: string | null },
  /** displays this ticket is open on right now */
  showingThisTicket: string[],
): DisplayPick {
  if (want.deviceId) {
    const d = devices.find((x) => x.deviceId === want.deviceId);
    if (!d) return { ok: false, reason: 'not_found', message: 'That customer display is not paired in this branch.' };
    if (d.maintenance) return { ok: false, reason: 'maintenance', message: `${name(d)} is in maintenance. Continue checkout on the POS, or choose another display.` };
    if (!d.online) return { ok: false, reason: 'offline', message: `${name(d)} is offline. Continue checkout on the POS, or choose another display.` };
    return { ok: true, order: [d] };
  }
  // already showing this customer: send it there again (a fresh session replaces the old one) — never a second screen
  const current = devices.find((d) => showingThisTicket.includes(d.deviceId) && d.online && !d.maintenance);
  if (current) return { ok: true, order: [current] };

  const station = want.stationId || null;
  const dedicated = station ? devices.filter((d) => d.stationId === station) : [];
  const shared = devices.filter((d) => !d.stationId);
  const pool = [...dedicated, ...shared];
  if (!pool.length) {
    if (!devices.length) return { ok: false, reason: 'no_display', message: 'No customer display is paired in this branch. Continue checkout on the POS.' };
    return station
      ? { ok: false, reason: 'no_display_for_register', message: 'This register has no customer display. Use Switch Display to choose one, or continue on the POS.' }
      : { ok: false, reason: 'no_display_for_register', message: 'Every display here belongs to a register. Choose this POS’s register on the Customer Display card.' };
  }
  const usable = pool.filter((d) => !d.maintenance);
  if (!usable.length) return { ok: false, reason: 'maintenance', message: `${name(pool[0])} is in maintenance. Continue checkout on the POS.` };
  const online = usable.filter((d) => d.online);
  if (!online.length) return { ok: false, reason: 'offline', message: `${name(usable[0])} is offline. Continue checkout on the POS.` };
  return { ok: true, order: online };
}
