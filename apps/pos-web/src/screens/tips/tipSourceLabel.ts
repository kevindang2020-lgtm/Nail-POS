// tipSourceLabel.ts — Extras (Tips & Gratuity 10): one source-of-truth label per tip, from fields the server already returns
// (tips-screen.repository): the collected ticket tip, the allocation rows, the frozen compensation snapshot, and posted
// reversals / manual corrections. Never guessed — a tip with no snapshot yet says so instead of claiming "verified".
//   review     — the frozen snapshot disagrees with the collected tip (a manager must look; nothing is auto-fixed)
//   pending    — collected but not fully allocated, or the compensation snapshot has not been written yet
//   adjusted   — fully allocated and matching, with a posted reversal or manual correction since
//   verified   — collected = allocated = snapshot, no corrections
//   null       — no tip on this ticket (nothing to label)
export type TipSourceLabel = 'review' | 'pending' | 'adjusted' | 'verified';
export const TIP_SOURCE_TONE: Record<TipSourceLabel, string> = { review: 'bad', pending: 'warn', adjusted: 'info', verified: 'ok' };

export function tipSourceLabel(r: { amountCents: number; allocationState: string; snapshotCents: number | null; snapshotMismatch: boolean; reversedCents: number; manualCorrectionCents: number }): TipSourceLabel | null {
  if (!r.amountCents) return null;
  if (r.snapshotMismatch) return 'review';
  if (r.allocationState !== 'allocated' || r.snapshotCents == null) return 'pending';
  if (r.reversedCents || r.manualCorrectionCents) return 'adjusted';
  return 'verified';
}
