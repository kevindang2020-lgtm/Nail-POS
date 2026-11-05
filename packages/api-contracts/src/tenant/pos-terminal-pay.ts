// pos-terminal-pay.ts (tenant realm) — Fiserv master build §7 (Nov 2026): the front desk's Card button drives the Clover
// Compact at this location. Server: apps/api customer-display/pos-terminal-pay.controller.ts. Client: pos-web
// posCheckoutApi (terminals / payTerminal / cancelTerminal) and Devices → Payment Terminals (assign-location).

/** A paired terminal the front desk may pick for this branch (never another branch's). */
export interface PosTerminalOption {
  id: string; label: string; stationId: string | null; disabled: boolean; lastSeenAt: string | null; hsnConfigured: boolean;
}
/** The five front-desk states (§7.2). UNKNOWN is never a decline: the POS offers Verify, never "pay again". */
export type PosTerminalStatus = 'approved' | 'declined' | 'unknown' | 'unavailable' | 'in_progress';
export interface PosTerminalPayResult {
  status: PosTerminalStatus;
  paymentId?: string;
  retref?: string;
  amountCents?: number;
  message?: string;
  /** what the POS should offer next */
  next: 'done' | 'retry' | 'verify' | 'wait';
}
/** POS "Cancel on terminal". relayed = the charge runs on another API server; that server sends the cancel (migration 703). */
export interface PosTerminalCancelResult { cancelled: boolean; relayed?: boolean; reason?: string }
/** Devices → "Assign to this location": the terminal row after it was given the signed-in location. */
export interface PosTerminalLocationAssigned { id: string; label: string; status: 'paired' | 'unpaired'; unassigned?: boolean; [k: string]: unknown }
