// ai-booking-metrics-core.ts — pure computation of AI-booking conversion metrics from funnel rows (§27/§46). Kept
// side-effect-free so the formulas are documented and unit-tested without a DB. Input is the raw stage rows for a
// tenant (already tenant-scoped by the caller); output is per-source and overall rollups plus a failure breakdown.
//
// Documented formulas (§27):
//   attempts(source)        = count(stage = BOOKING_ATTEMPTED)
//   successes(source)       = count(stage = BOOKING_SUCCEEDED)
//   failures(source)        = count(stage = BOOKING_FAILED)
//   searches(source)        = count(stage = AVAILABILITY_SEARCHED)
//   bookingConversionRate   = successes / max(1, attempts)          -- attempt → confirmed booking
//   searchToBookingRate     = successes / max(1, searches)          -- availability search → confirmed booking
//   handoffs(source)        = count(stage = HUMAN_HANDOFF)
// Rates are rounded to 4 dp. A source with no attempts reports rate 0 (not NaN).
export interface FunnelRow { source: string; stage: string; outcome?: string | null; failureReason?: string | null }

export interface SourceMetrics {
  source: string; searches: number; attempts: number; successes: number; failures: number; handoffs: number;
  bookingConversionRate: number; searchToBookingRate: number;
}
export interface ConversionMetrics {
  overall: Omit<SourceMetrics, 'source'>;
  bySource: SourceMetrics[];
  failureReasons: { reason: string; count: number }[];
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function computeConversionMetrics(rows: FunnelRow[]): ConversionMetrics {
  const bySourceMap = new Map<string, { searches: number; attempts: number; successes: number; failures: number; handoffs: number }>();
  const failures = new Map<string, number>();
  let searches = 0, attempts = 0, successes = 0, failuresTotal = 0, handoffs = 0;

  const bump = (src: string, k: 'searches' | 'attempts' | 'successes' | 'failures' | 'handoffs') => {
    const m = bySourceMap.get(src) ?? { searches: 0, attempts: 0, successes: 0, failures: 0, handoffs: 0 };
    m[k]++; bySourceMap.set(src, m);
  };

  for (const row of rows) {
    switch (row.stage) {
      case 'AVAILABILITY_SEARCHED': searches++; bump(row.source, 'searches'); break;
      case 'BOOKING_ATTEMPTED': attempts++; bump(row.source, 'attempts'); break;
      case 'BOOKING_SUCCEEDED': successes++; bump(row.source, 'successes'); break;
      case 'BOOKING_FAILED': failuresTotal++; bump(row.source, 'failures'); if (row.failureReason) failures.set(row.failureReason, (failures.get(row.failureReason) ?? 0) + 1); break;
      case 'HUMAN_HANDOFF': handoffs++; bump(row.source, 'handoffs'); break;
      default: break;
    }
  }

  const bySource: SourceMetrics[] = [...bySourceMap.entries()].map(([source, m]) => ({
    source, ...m,
    bookingConversionRate: r4(m.successes / Math.max(1, m.attempts)),
    searchToBookingRate: r4(m.successes / Math.max(1, m.searches)),
  })).sort((a, b) => b.successes - a.successes);

  return {
    overall: { searches, attempts, successes, failures: failuresTotal, handoffs, bookingConversionRate: r4(successes / Math.max(1, attempts)), searchToBookingRate: r4(successes / Math.max(1, searches)) },
    bySource,
    failureReasons: [...failures.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}
