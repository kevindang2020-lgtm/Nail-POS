import type { OwnerDrawerRow, OwnerDrawerSummary, DrawerState, DrawerStatus } from '@aipowersalon/api-contracts/tenant';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { CashMovement, MovementList } from '@aipowersalon/api-contracts/tenant';
import type { CashMovement, MovementList } from '@aipowersalon/api-contracts/tenant';
export type { OwnerDrawerRow, OwnerDrawerSummary, DrawerState, DrawerStatus };   // owned by packages/api-contracts (Constitution 13 §13)




export const DRAWER_EVENTS = {
  opened: 'cash_drawer_opened',
  reconciled: 'cash_drawer_reconciled',
  discrepancy: 'cash_drawer_discrepancy',
  movement: 'cash_drawer_movement',
} as const;

export class CashDrawerError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) { super(message); }
}

export const num = (v: any): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
export const isUuid = (x: any): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export const today = (): string => new Date().toISOString().slice(0, 10);
/** A YYYY-MM-DD the caller sent, else `todayYmd` — the branch's business date (Oct 6 2026), else the UTC date. */
export const normDate = (d?: string, todayYmd?: string): string => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : (todayYmd || today()));
