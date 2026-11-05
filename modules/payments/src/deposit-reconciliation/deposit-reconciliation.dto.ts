// deposit-reconciliation.dto.ts — AI Deposit Reconciliation core types + the PURE, deterministic matching and
// expected-deposit engine. All money is integer cents. These functions have no I/O so they are fully unit-
// testable and are the single source of truth for how settlements match bank deposits — AI never overrides them.
//
// Reuse note: Settlement rows come from the EXISTING payment_settlements table; only the bank side
// (bank_accounts, bank_deposits) is new. This module does not duplicate the settlement/payout/dispute systems.

export interface ReconContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

// Normalized settlement (from payment_settlements). expectedNetCents is what the bank deposit SHOULD be.
export interface Settlement {
  id: string;
  branchId: string | null;
  processorType: string | null;
  settlementRef: string | null;   // processor batch/settlement id
  grossCents: number;
  feeCents: number;
  netCents: number;               // gross - fees = expected deposit
  currency: string;
  status: string;
  settledAt: string | null;
}

export interface BankAccount {
  id: string; nickname: string; bankName: string | null; accountType: string;
  accountLast4: string | null; currency: string; status: string;
}

export interface BankDeposit {
  id: string; branchId: string | null; bankAccountId: string; amountCents: number; currency: string;
  depositDate: string | null; postedAt: string | null; description: string | null; reference: string | null;
  externalBankTxnId: string | null; source: string; status: string;
  matchedSettlementId: string | null; reconciliationStatus: string;
}

export type ReconStatus = 'matched' | 'matched_with_tolerance' | 'unmatched_settlement' | 'missing_deposit';
export type MatchType = 'reference' | 'amount_exact' | 'amount_tolerance' | 'none';

export interface ReconRow {
  settlementId: string;
  processorType: string | null;
  settledAt: string | null;
  grossCents: number;
  feeCents: number;
  expectedNetCents: number;
  depositId: string | null;
  actualCents: number | null;
  differenceCents: number;        // actual - expected (0 when unmatched)
  status: ReconStatus;
  matchType: MatchType;
  confidence: number;             // 0..1
  dateDiffDays: number | null;
}

export interface ReconKpis {
  settlementCount: number;
  expectedCents: number;
  actualMatchedCents: number;
  matched: number;
  matchedWithTolerance: number;
  unmatchedSettlements: number;
  missingDeposits: number;
  unmatchedDeposits: number;
  differenceCents: number;        // sum of |difference| across matched rows
}

export interface ReconState {
  kpis: ReconKpis;
  rows: ReconRow[];
  unmatchedDeposits: BankDeposit[];
}

export interface ReconOptions {
  toleranceCents: number;   // amount tolerance for matched_with_tolerance
  dateWindowDays: number;   // max |deposit.date - settled.date| for an amount match
  fundingWindowDays: number; // after this many days with no deposit, a settlement is "missing_deposit"
  nowIso: string;
}
export const DEFAULT_RECON_OPTIONS: Omit<ReconOptions, 'nowIso'> = { toleranceCents: 100, dateWindowDays: 5, fundingWindowDays: 3 };

// ---- pure helpers ----
const dayMs = 86400000;
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = Date.parse(a), db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round(Math.abs(da - db) / dayMs);
}

// Expected deposit for a settlement = its net (gross - fees). Kept as a function so future deduction types
// (reserves, chargebacks) can extend it without changing callers.
export function expectedDepositCents(s: Settlement): number { return s.netCents; }

// Find the best deposit for one settlement among the available (unclaimed) deposits.
// Deterministic priority: exact processor-reference match > exact amount (in date window) > amount within
// tolerance (in date window). Returns null when nothing qualifies.
export function matchSettlement(
  s: Settlement, deposits: BankDeposit[], opts: ReconOptions,
): { deposit: BankDeposit; matchType: MatchType; status: ReconStatus; confidence: number; dateDiffDays: number | null } | null {
  const expected = expectedDepositCents(s);
  // 1) exact reference match (strongest evidence)
  if (s.settlementRef) {
    const ref = s.settlementRef.toLowerCase();
    const byRef = deposits.find((d) => (d.reference && d.reference.toLowerCase() === ref) || (d.externalBankTxnId && d.externalBankTxnId.toLowerCase() === ref));
    if (byRef) {
      const exact = byRef.amountCents === expected;
      return { deposit: byRef, matchType: 'reference', status: exact ? 'matched' : 'matched_with_tolerance', confidence: exact ? 1 : 0.9, dateDiffDays: daysBetween(byRef.depositDate, s.settledAt) };
    }
  }
  // 2) exact amount within the date window
  const inWindow = (d: BankDeposit) => { const dd = daysBetween(d.depositDate, s.settledAt); return dd == null || dd <= opts.dateWindowDays; };
  const exactAmt = deposits.find((d) => d.amountCents === expected && d.currency === s.currency && inWindow(d));
  if (exactAmt) return { deposit: exactAmt, matchType: 'amount_exact', status: 'matched', confidence: 0.85, dateDiffDays: daysBetween(exactAmt.depositDate, s.settledAt) };
  // 3) amount within tolerance, in the date window — pick the closest amount
  const candidates = deposits
    .filter((d) => d.currency === s.currency && inWindow(d) && Math.abs(d.amountCents - expected) <= opts.toleranceCents)
    .sort((a, b) => Math.abs(a.amountCents - expected) - Math.abs(b.amountCents - expected));
  if (candidates.length) { const d = candidates[0]; return { deposit: d, matchType: 'amount_tolerance', status: 'matched_with_tolerance', confidence: 0.6, dateDiffDays: daysBetween(d.depositDate, s.settledAt) }; }
  return null;
}

// Build the full reconciliation state. Greedy: each deposit is claimed by at most one settlement. Settlements
// are processed oldest-first so earlier settlements claim their deposits first (stable, deterministic).
export function buildReconState(settlements: Settlement[], deposits: BankDeposit[], opts: ReconOptions): ReconState {
  const claimed = new Set<string>();
  const rows: ReconRow[] = [];
  const bySettledAsc = [...settlements].sort((a, b) => String(a.settledAt || '').localeCompare(String(b.settledAt || '')));
  for (const s of bySettledAsc) {
    const expected = expectedDepositCents(s);
    const avail = deposits.filter((d) => !claimed.has(d.id));
    const m = matchSettlement(s, avail, opts);
    if (m) {
      claimed.add(m.deposit.id);
      rows.push({ settlementId: s.id, processorType: s.processorType, settledAt: s.settledAt, grossCents: s.grossCents, feeCents: s.feeCents, expectedNetCents: expected, depositId: m.deposit.id, actualCents: m.deposit.amountCents, differenceCents: m.deposit.amountCents - expected, status: m.status, matchType: m.matchType, confidence: m.confidence, dateDiffDays: m.dateDiffDays });
    } else {
      // no deposit: missing (past funding window) vs simply not-yet-due
      const age = daysBetween(opts.nowIso, s.settledAt);
      const missing = s.status !== 'pending' && age != null && age > opts.fundingWindowDays;
      rows.push({ settlementId: s.id, processorType: s.processorType, settledAt: s.settledAt, grossCents: s.grossCents, feeCents: s.feeCents, expectedNetCents: expected, depositId: null, actualCents: null, differenceCents: 0, status: missing ? 'missing_deposit' : 'unmatched_settlement', matchType: 'none', confidence: 0, dateDiffDays: null });
    }
  }
  const unmatchedDeposits = deposits.filter((d) => !claimed.has(d.id));
  rows.sort((a, b) => String(b.settledAt || '').localeCompare(String(a.settledAt || ''))); // newest first for display
  const kpis: ReconKpis = {
    settlementCount: settlements.length,
    expectedCents: rows.reduce((a, r) => a + r.expectedNetCents, 0),
    actualMatchedCents: rows.reduce((a, r) => a + (r.actualCents || 0), 0),
    matched: rows.filter((r) => r.status === 'matched').length,
    matchedWithTolerance: rows.filter((r) => r.status === 'matched_with_tolerance').length,
    unmatchedSettlements: rows.filter((r) => r.status === 'unmatched_settlement').length,
    missingDeposits: rows.filter((r) => r.status === 'missing_deposit').length,
    unmatchedDeposits: unmatchedDeposits.length,
    differenceCents: rows.reduce((a, r) => a + Math.abs(r.differenceCents), 0),
  };
  return { kpis, rows, unmatchedDeposits };
}

// ---- validation for writes ----
export function validateBankAccount(input: { nickname?: string; accountLast4?: string | null }): { ok: boolean; error?: string } {
  if (!input?.nickname || !String(input.nickname).trim()) return { ok: false, error: 'A nickname is required' };
  // last4 is sanitized server-side (digits stripped + truncated to the last 4) as defense-in-depth so a full
  // account number can never be persisted — so we don't reject a longer value here, we shorten it.
  return { ok: true };
}
// Sanitize any account-number-ish input down to at most the last 4 digits. Never returns more than 4 chars.
export function sanitizeLast4(v: string | null | undefined): string | null {
  if (!v) return null; const digits = String(v).replace(/\D/g, ''); return digits ? digits.slice(-4) : null;
}
export function validateDeposit(input: { bankAccountId?: string; amountCents?: number }): { ok: boolean; error?: string } {
  if (!input?.bankAccountId) return { ok: false, error: 'A bank account is required' };
  if (input.amountCents == null || !Number.isFinite(Number(input.amountCents))) return { ok: false, error: 'A deposit amount is required' };
  return { ok: true };
}
