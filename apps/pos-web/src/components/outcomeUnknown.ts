// outcomeUnknown.ts — round 10 (Inventory 10): did a failed write maybe happen? No answer / a server error / a timeout / an
// in-progress conflict = the outcome is UNKNOWN (it may have been saved, so a retry must reuse the same Idempotency-Key and the
// screen says the retry is safe); a 4xx refusal (validation, permission, not found) is known: nothing was saved.
export const outcomeUnknown = (e: unknown): boolean => {
  const st = (e as { status?: unknown } | null)?.status;
  return typeof st !== 'number' || st === 0 || st >= 500 || st === 408 || st === 409;
};
