// deposit-reconciliation.duplicates.ts — PURE duplicate detection for settlements and bank deposits. Reads the
// existing settlement/deposit data (no new tables). Per spec: the STRONGEST signal is an external/provider/bank
// identifier (exact duplicate); a matching amount+date (+reference) is a weaker "likely"/"possible" signal.
// Filenames alone are NEVER used. Detection is always run within a single tenant's data by the caller.
import type { Settlement, BankDeposit } from './deposit-reconciliation.dto';

export type DupKind = 'settlement' | 'deposit';
export type DupSeverity = 'exact_duplicate' | 'likely_duplicate' | 'possible_duplicate';
export type DupSignal = 'external_id' | 'amount_date_reference' | 'amount_date';

export interface DuplicateMember { id: string; amountCents: number; date: string | null; ref: string | null }
export interface DuplicateGroup {
  kind: DupKind;
  severity: DupSeverity;
  signal: DupSignal;
  key: string;
  amountCents: number;
  members: DuplicateMember[];   // 2+ records that look like duplicates of each other
}

export interface DuplicatesKpis {
  settlementGroups: number;
  depositGroups: number;
  exact: number;
  likely: number;
  possible: number;
  duplicateRecordCount: number;   // records beyond the first in each group (the "extra" copies)
}
export interface DuplicatesState { kpis: DuplicatesKpis; groups: DuplicateGroup[] }

function groupBy<T>(rows: T[], keyOf: (r: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = keyOf(r); if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
}

export function detectSettlementDuplicates(settlements: Settlement[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>(); // member ids already claimed by a stronger group
  // 1) exact: same processor settlement reference
  for (const [ref, rows] of groupBy(settlements, (s) => (s.settlementRef ? `${s.processorType || ''}::${s.settlementRef.toLowerCase()}` : null))) {
    if (rows.length < 2) continue;
    rows.forEach((r) => seen.add(r.id));
    groups.push({ kind: 'settlement', severity: 'exact_duplicate', signal: 'external_id', key: ref, amountCents: rows[0].netCents, members: rows.map((r) => ({ id: r.id, amountCents: r.netCents, date: r.settledAt, ref: r.settlementRef })) });
  }
  // 2) possible: same net amount + settled date, among rows not already in an exact group
  const rest = settlements.filter((s) => !seen.has(s.id));
  for (const [key, rows] of groupBy(rest, (s) => (s.settledAt ? `${s.netCents}::${String(s.settledAt).slice(0, 10)}` : null))) {
    if (rows.length < 2) continue;
    groups.push({ kind: 'settlement', severity: 'possible_duplicate', signal: 'amount_date', key, amountCents: rows[0].netCents, members: rows.map((r) => ({ id: r.id, amountCents: r.netCents, date: r.settledAt, ref: r.settlementRef })) });
  }
  return groups;
}

export function detectDepositDuplicates(deposits: BankDeposit[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  // 1) exact: same external bank transaction id (within account)
  for (const [key, rows] of groupBy(deposits, (d) => (d.externalBankTxnId ? `${d.bankAccountId}::${d.externalBankTxnId.toLowerCase()}` : null))) {
    if (rows.length < 2) continue;
    rows.forEach((r) => seen.add(r.id));
    groups.push({ kind: 'deposit', severity: 'exact_duplicate', signal: 'external_id', key, amountCents: rows[0].amountCents, members: rows.map((r) => ({ id: r.id, amountCents: r.amountCents, date: r.depositDate, ref: r.reference })) });
  }
  // 2) likely: same amount + date + reference; 3) possible: same amount + date
  const rest = deposits.filter((d) => !seen.has(d.id));
  for (const [key, rows] of groupBy(rest, (d) => (d.depositDate && d.reference ? `${d.amountCents}::${d.depositDate}::${d.reference.toLowerCase()}` : null))) {
    if (rows.length < 2) continue;
    rows.forEach((r) => seen.add(r.id));
    groups.push({ kind: 'deposit', severity: 'likely_duplicate', signal: 'amount_date_reference', key, amountCents: rows[0].amountCents, members: rows.map((r) => ({ id: r.id, amountCents: r.amountCents, date: r.depositDate, ref: r.reference })) });
  }
  const rest2 = deposits.filter((d) => !seen.has(d.id));
  for (const [key, rows] of groupBy(rest2, (d) => (d.depositDate ? `${d.amountCents}::${d.depositDate}` : null))) {
    if (rows.length < 2) continue;
    groups.push({ kind: 'deposit', severity: 'possible_duplicate', signal: 'amount_date', key, amountCents: rows[0].amountCents, members: rows.map((r) => ({ id: r.id, amountCents: r.amountCents, date: r.depositDate, ref: r.reference })) });
  }
  return groups;
}

export function buildDuplicatesState(settlements: Settlement[], deposits: BankDeposit[]): DuplicatesState {
  const groups = [...detectSettlementDuplicates(settlements), ...detectDepositDuplicates(deposits)];
  const kpis: DuplicatesKpis = {
    settlementGroups: groups.filter((g) => g.kind === 'settlement').length,
    depositGroups: groups.filter((g) => g.kind === 'deposit').length,
    exact: groups.filter((g) => g.severity === 'exact_duplicate').length,
    likely: groups.filter((g) => g.severity === 'likely_duplicate').length,
    possible: groups.filter((g) => g.severity === 'possible_duplicate').length,
    duplicateRecordCount: groups.reduce((a, g) => a + (g.members.length - 1), 0),
  };
  return { kpis, groups };
}
