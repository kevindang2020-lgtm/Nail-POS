// post-restore-hold.ts — mandate §212 (Oct 20 2026): after a database RESTORE, outgoing work must not replay.
//
// A restore rolls the database back to a snapshot. Everything that was already sent out after that snapshot — receipts
// and SMS, push notifications, membership renewals BILLED to a card (their duplicate check, renewalIdempotencyKey, lives
// only in the database that was just rolled back; CardPointe does not dedupe), payouts, partner webhooks — is now
// "pending" again in the restored data, and the workers would simply do it a second time. MAINTENANCE_BREAK_GLASS stops
// HTTP requests only; the workers kept running.
//
// POST_RESTORE_HOLD=1 is the environment switch the operator sets TOGETHER WITH the restore (Railway → Variables, before
// the workers come back) and clears only after the reconciliation checklist in DISASTER_RECOVERY.md §3.1 is done. While
// it is set:
//   • the job worker claims NO jobs (every class — nothing outbound, nothing billed, nothing reconciled against the
//     processor from stale data);
//   • the outbox publisher dispatches NO events (receipts / SMS / push / in-app all hang off consumers);
//   • every runTick scheduler (membership renewals + autobill, reminders, sweeps, exports, digests …) skips its tick;
//   • the HTTP API keeps working (people can read and work); System Status shows the hold so nobody forgets it.
// Read from process.env on every check: flipping the variable on the host is enough, no deploy.
export function postRestoreHoldActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.POST_RESTORE_HOLD ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
/** The sentence every skipped worker logs once and System Status shows. */
export const POST_RESTORE_HOLD_MESSAGE = 'POST_RESTORE_HOLD is set: background work (jobs, outbox dispatch, schedulers) is paused until the post-restore reconciliation is done and the variable is cleared (DISASTER_RECOVERY.md §3.1).';
