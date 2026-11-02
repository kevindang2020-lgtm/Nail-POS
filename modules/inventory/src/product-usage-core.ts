// product-usage-core.ts — Stock Alerts + Technician Product Usage mandate (Oct 29 2026): the framework-free math of a usage
// event. Stock is the bottle rows; a bottle's REMAINING fraction is its estimated_remaining_percent (an unopened bottle, or an
// opened one nobody estimated, is 100 %; a bottle marked low without an estimate counts 25 %). A use of q base units takes q
// from the bottles in a fixed order — the bottle the technician named, then low, then opened (least left first), then sealed
// bottles oldest first — opening a sealed bottle it starts and emptying a bottle it finishes. Quantities are integer
// HUNDREDTHS of the base unit, so 0.5 bottle is exactly 50 and no floating point ever touches stock.
import type { BottleStatus } from './inventory-core';

export const HUNDREDTHS = 100;
export const USABLE_STATUSES: readonly BottleStatus[] = ['unopened', 'opened', 'low'];
/** Units that can only be used whole (gloves, files, tips …); fractions are refused for them. */
const WHOLE_UNITS = new Set(['piece', 'pieces', 'pair', 'pairs', 'pack', 'packs', 'box', 'boxes', 'each', 'unit', 'units', 'kit', 'kits', 'roll', 'rolls']);
export const allowsFraction = (unitType: string | null | undefined): boolean => !WHOLE_UNITS.has(String(unitType ?? '').toLowerCase().trim());

/** "0.5", "1", "0.25", "2.75" → hundredths (50, 100, 25, 275); null for anything that is not a positive amount with ≤ 2 decimals. */
export function parseQuantity(v: unknown): number | null {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v ?? '').trim();
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * HUNDREDTHS + Number((m[2] ?? '').padEnd(2, '0'));
  return n > 0 ? n : null;
}
export const formatQuantity = (h: number): string => { const sign = h < 0 ? '-' : ''; const a = Math.abs(h); const w = Math.floor(a / HUNDREDTHS), f = a % HUNDREDTHS; return sign + (f ? `${w}.${String(f).padStart(2, '0').replace(/0$/, '')}` : String(w)); };

export interface BottleRow { id: string; status: BottleStatus; remainingPercent: number | null; createdAt: string }
/** What a usable bottle still holds, in hundredths. */
export function remainingOf(b: Pick<BottleRow, 'status' | 'remainingPercent'>): number {
  if (!USABLE_STATUSES.includes(b.status)) return 0;
  if (b.remainingPercent != null && Number.isFinite(b.remainingPercent)) return Math.max(0, Math.min(HUNDREDTHS, Math.round(b.remainingPercent)));
  return b.status === 'low' ? 25 : HUNDREDTHS;
}
export const stockHundredths = (bottles: BottleRow[]): number => bottles.reduce((n, b) => n + remainingOf(b), 0);

export interface Take { unitId: string; takenHundredths: number; remainingBefore: number; remainingAfter: number; fromStatus: BottleStatus; toStatus: BottleStatus }
/** The order bottles are used in (see the header). */
export function consumptionOrder(bottles: BottleRow[], preferredUnitId?: string | null): BottleRow[] {
  const rank = (b: BottleRow) => (b.id === preferredUnitId ? 0 : b.status === 'low' ? 1 : b.status === 'opened' ? 2 : 3);
  return bottles.filter((b) => remainingOf(b) > 0).sort((a, b) => rank(a) - rank(b) || (rank(a) < 3 ? remainingOf(a) - remainingOf(b) : 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
/** Allocate `want` hundredths across the bottles; `short` is what the bottles could not cover. */
export function allocate(bottles: BottleRow[], want: number, preferredUnitId?: string | null): { takes: Take[]; short: number } {
  let need = want; const takes: Take[] = [];
  for (const b of consumptionOrder(bottles, preferredUnitId)) {
    if (need <= 0) break;
    const before = remainingOf(b); const take = Math.min(before, need); const after = before - take;
    takes.push({ unitId: b.id, takenHundredths: take, remainingBefore: before, remainingAfter: after, fromStatus: b.status, toStatus: after === 0 ? 'empty' : b.status === 'unopened' ? 'opened' : b.status });
    need -= take;
  }
  return { takes, short: Math.max(0, need) };
}

/** A correction that gives back `amount` hundredths: first any shortfall (never stock), then the bottles the event took,
 *  latest take first, each no more than it still owes. `restoredSoFar` is what earlier corrections already gave back per bottle. */
export function planRestore(takes: Take[], shortRemaining: number, restoredSoFar: Record<string, number>, amount: number): { fromShort: number; restores: { unitId: string; hundredths: number }[]; uncovered: number } {
  let left = amount; const fromShort = Math.min(shortRemaining, left); left -= fromShort;
  const restores: { unitId: string; hundredths: number }[] = [];
  for (const t of [...takes].reverse()) {
    if (left <= 0) break;
    const owed = t.takenHundredths - (restoredSoFar[t.unitId] ?? 0);
    if (owed <= 0) continue;
    const give = Math.min(owed, left); restores.push({ unitId: t.unitId, hundredths: give }); left -= give;
    restoredSoFar = { ...restoredSoFar, [t.unitId]: (restoredSoFar[t.unitId] ?? 0) + give };
  }
  return { fromShort, restores, uncovered: left };
}
/** A bottle after `hundredths` are given back to it: an emptied bottle is usable again (opened); a sealed bottle this event
 *  opened goes back to sealed only when it is whole again and it was sealed before. */
export function restoredStatus(current: BottleStatus, remainingNow: number, add: number, wasSealed: boolean): { status: BottleStatus; remaining: number } | null {
  if (!(['empty', 'opened', 'low'] as BottleStatus[]).includes(current)) return null;   // sold / disposed / damaged … cannot take stock back
  const remaining = Math.min(HUNDREDTHS, remainingNow + add);
  if (remaining >= HUNDREDTHS && wasSealed) return { status: 'unopened', remaining: HUNDREDTHS };
  return { status: current === 'low' ? 'low' : 'opened', remaining };
}
