// audit-partitions-core.ts — pure helpers for monthly audit_events partitions. Kept side-effect-free so partition
// naming, month math, and the generated DDL are unit-tested without a database. Used by AuditPartitionService to keep
// upcoming months provisioned once the table has been converted to a partitioned table (db/maintenance script).
export interface YearMonth { year: number; month: number }   // month is 1-12

export function partitionName(ym: YearMonth): string {
  return `audit_events_${ym.year}_${String(ym.month).padStart(2, '0')}`;
}

/** Half-open range [from, to) for a month — the exact bounds Postgres RANGE partitions use. */
export function partitionBounds(ym: YearMonth): { from: string; to: string } {
  const from = `${ym.year}-${String(ym.month).padStart(2, '0')}-01`;
  const nextMonth = ym.month === 12 ? 1 : ym.month + 1;
  const nextYear = ym.month === 12 ? ym.year + 1 : ym.year;
  const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { from, to };
}

/** The current month plus `ahead` following months (so partitions always exist before writes land in them). */
export function upcomingMonths(now: Date, ahead: number): YearMonth[] {
  const out: YearMonth[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i <= ahead; i++) {
    out.push({ year: y, month: m });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Idempotent DDL to ensure one month's partition exists. */
export function ensurePartitionSql(ym: YearMonth): string {
  const { from, to } = partitionBounds(ym);
  return `CREATE TABLE IF NOT EXISTS ${partitionName(ym)} PARTITION OF audit_events FOR VALUES FROM ('${from}') TO ('${to}')`;
}
