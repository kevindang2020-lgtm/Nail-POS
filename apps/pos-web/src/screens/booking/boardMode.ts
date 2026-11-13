// boardMode.ts — which Booking schedule board this person sees (merge of the Booking Schedule Board, Nov 13 2026).
// The new board is the default; "Classic board" keeps the previous calendar recoverable (standalone spec §42: keep the old
// board recoverable until the new one has passed regression). The choice is per signed-in person at this salon, on this
// device (browser storage, like the spacing preference) — UI only: it never changes a booking or a permission.
import { useCallback, useState } from 'react';

export type BookingBoardMode = 'new' | 'classic';
export const BOOKING_BOARD_DEFAULT: BookingBoardMode = 'new';

export function boardModeKey(tenantId: string | null | undefined, userId: string | null | undefined): string {
  return `aps.pos.bookingBoard.v1:${tenantId ?? ''}:${userId ?? ''}`;
}
type Store = Pick<Storage, 'getItem' | 'setItem'> | null;
const local = (): Store => (typeof localStorage !== 'undefined' ? localStorage : null);

export function readBoardMode(key: string, store: Store = local()): BookingBoardMode {
  try { return store?.getItem(key) === 'classic' ? 'classic' : BOOKING_BOARD_DEFAULT; } catch { return BOOKING_BOARD_DEFAULT; }   // storage blocked: the default
}
export function saveBoardMode(key: string, mode: BookingBoardMode, store: Store = local()): void {
  try { store?.setItem(key, mode); } catch { /* storage blocked: the choice still applies for this visit */ }
}

/** [mode, setMode] — persisted per person (tenant + user). */
export function useBookingBoardMode(tenantId: string | null | undefined, userId: string | null | undefined): [BookingBoardMode, (m: BookingBoardMode) => void] {
  const key = boardModeKey(tenantId, userId);
  const [state, setState] = useState<{ key: string; mode: BookingBoardMode }>(() => ({ key, mode: readBoardMode(key) }));
  const mode = state.key === key ? state.mode : readBoardMode(key);   // another person signed in on this terminal → their own choice
  const set = useCallback((m: BookingBoardMode) => { saveBoardMode(key, m); setState({ key, mode: m }); }, [key]);
  return [mode, set];
}
