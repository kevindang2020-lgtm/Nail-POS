// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface LockResult {
  acquired: boolean;
  action: 'acquired' | 'refreshed' | 'taken_over';
  expiresAt: string;
}

export interface LockStatus {
  locked: boolean;
  ownedByCaller: boolean;
  heldBy?: { source: LockSource; message: string; expiresAt: string } | null;
}

/** Who holds a ticket: the manager's mobile checkout, a POS payment being recorded, or the customer display's own card
 *  charge on the terminal (Oct 6 2026 — one lock per ticket, so two payments can never be taken at once). */
export type LockSource = 'mobile' | 'pos' | 'display';
