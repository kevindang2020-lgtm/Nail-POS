// tipSplitPreview.ts — Extras (Tips & Gratuity 02): before an authorized tip re-allocation is confirmed, show the EXACT cents
// each technician ends up with, the change from what they hold now, and where the rounding remainder goes. Pure integer
// cents; nothing is saved from here (the save stays the reasoned, step-up tips.adjust route).

/** equal shares of `totalCents` over `n` people: floor each, the leftover cents one each to the first in list order
 *  (the same largest-remainder rule as checkout's splitByWeights with equal weights) — always sums to the total */
export function evenSplit(totalCents: number, n: number): { parts: number[]; remainderCents: number } {
  const total = Math.max(0, Math.round(totalCents || 0));
  if (n <= 0) return { parts: [], remainderCents: 0 };
  const base = Math.floor(total / n); const remainderCents = total - base * n;
  return { parts: Array.from({ length: n }, (_, i) => base + (i < remainderCents ? 1 : 0)), remainderCents };
}

export interface SplitPreviewRow { technicianId: string; name: string | null; beforeCents: number; afterCents: number; deltaCents: number }
/** per technician: before → after and the change; `balanced` only when Σ after equals the collected tip exactly */
export function splitPreview(totalCents: number, rows: Array<{ technicianId: string; name: string | null; beforeCents: number; afterCents: number }>) {
  const out: SplitPreviewRow[] = rows.map((r) => ({ ...r, deltaCents: r.afterCents - r.beforeCents }));
  const sumAfter = out.reduce((a, r) => a + r.afterCents, 0);
  return { rows: out, sumAfterCents: sumAfter, differenceCents: totalCents - sumAfter, balanced: sumAfter === totalCents, changed: out.some((r) => r.deltaCents !== 0) };
}
