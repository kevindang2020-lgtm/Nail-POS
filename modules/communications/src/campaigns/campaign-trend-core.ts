// Pure, DB-free engine for the Campaign Performance Trend. Turns daily snapshots into per-day delivery/open/click
// rates with consistent, documented denominators. Returns available:false when there are no snapshots (honest — the
// module shows NotConnected rather than a fabricated flat line).

export interface SnapshotLike { snapshotDate: string; attempted: number; delivered: number; opened: number; clicked: number }
export interface TrendPoint { date: string; deliveryRate: number | null; openRate: number | null; clickRate: number | null }

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function buildTrend(snapshots: SnapshotLike[]): { available: boolean; points: TrendPoint[] } {
  if (!snapshots.length) return { available: false, points: [] };
  const points = [...snapshots]
    .sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1))
    .map((s) => ({
      date: s.snapshotDate,
      deliveryRate: pct(s.delivered, s.attempted),   // delivered ÷ attempted
      openRate: pct(s.opened, s.delivered),           // opened ÷ delivered
      clickRate: pct(s.clicked, s.delivered),         // clicked ÷ delivered
    }));
  return { available: true, points };
}
