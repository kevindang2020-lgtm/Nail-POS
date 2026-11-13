// boardMode.testkit.ts — test-only: run a Booking screen test against the CLASSIC board (the tests that pin the previous
// calendar's behaviour, which stays recoverable behind "Classic board"). Tests render without a signed-in principal, so the
// person key is the empty one.
import { afterEach, beforeEach } from 'vitest';
import { boardModeKey } from './boardMode';

export function runOnClassicBookingBoard(): void {
  beforeEach(() => { localStorage.setItem(boardModeKey(undefined, undefined), 'classic'); });
  afterEach(() => { localStorage.removeItem(boardModeKey(undefined, undefined)); });
}
