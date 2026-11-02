// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { HandoffStatus } from '@aipowersalon/api-contracts/tenant';
import type { HandoffStatus } from '@aipowersalon/api-contracts/tenant';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { CashHandoff, HandoffLine, CashHandoffDetail } from '@aipowersalon/api-contracts/tenant';
import type { CashHandoff, HandoffLine, CashHandoffDetail } from '@aipowersalon/api-contracts/tenant';
// tech-cash-handoff.dto.ts — types, events, helpers for end-of-day tech cash hand-off.



export const TCH_EVENTS = {
  handoffSubmitted: 'cash_handoff_submitted',
  handoffReconciled: 'cash_handoff_reconciled',
  handoffDiscrepancy: 'cash_handoff_discrepancy',
} as const;

export class TechCashHandoffError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) { super(message); }
}
/** End-of-Day Cash §16: two counters updating the same hand-off — the one who saw an older version is refused with the
 *  current figures so they can review instead of overwriting another manager's verified count. */
export class TechCashHandoffVersionConflict extends TechCashHandoffError {
  constructor(public readonly currentVersion: number, public readonly currentCountedCents: number | null, public readonly currentStatus: string) {
    super('version_conflict', 'This hand-off was changed by someone else. Review the current count before saving.', 409);
  }
}

export const num = (v: any): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
export const isUuid = (x: any): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export const today = (): string => new Date().toISOString().slice(0, 10);
/** A YYYY-MM-DD the caller sent, else `todayYmd` — the branch's business date (Oct 6 2026), else the UTC date. */
export const normDate = (d?: string, todayYmd?: string): string => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : (todayYmd || today()));
