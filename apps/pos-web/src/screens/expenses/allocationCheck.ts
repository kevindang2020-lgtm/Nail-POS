// Branch allocation checker (Extras backlog · Receipt Expense OCR Accounting 08): a salon-wide expense split across
// branches must add up to the exact cents of the expense. Pure: the splits come from the expense detail (the server
// already rejects a split that does not reconcile when it is saved — this re-checks what is stored and shows it).
export type Alloc = { branchId: string; amountCents: number; basisPoints?: number | null };
export type AllocCheck = { rows: (Alloc & { pct: number })[]; sumCents: number; diffCents: number; exact: boolean };

export function allocationCheck(raw: unknown[], amountCents: number): AllocCheck {
  const rows = (raw ?? []).map((a) => a as Partial<Alloc>).filter((a) => a && typeof a.branchId === 'string' && Number.isFinite(Number(a.amountCents)))
    .map((a) => ({ branchId: String(a.branchId), amountCents: Math.trunc(Number(a.amountCents)), basisPoints: a.basisPoints ?? null }));
  const sumCents = rows.reduce((s, a) => s + a.amountCents, 0);
  return { rows: rows.map((a) => ({ ...a, pct: amountCents > 0 ? Math.round((a.amountCents / amountCents) * 1000) / 10 : 0 })), sumCents, diffCents: amountCents - sumCents, exact: sumCents === amountCents };
}
