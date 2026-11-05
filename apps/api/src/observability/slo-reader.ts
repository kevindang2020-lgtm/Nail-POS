// slo-reader.ts — Constitution 11 §81, §330: SLO windows read from the per-minute request table (Phase 4).
//
// One query per SLO, every window at once (30 days, 6 h, 1 h, 30 min, 5 min) via FILTER, over an index on
// bucket_minute. Availability "bad" = status class 5. Latency "bad" = requests above the threshold, from the
// NON-cumulative bucket columns: total minus the buckets at or under it — exact, because thresholds are required to
// be bucket boundaries (slo-core's test enforces it).
import { sql } from 'kysely';
import { SLOS, report, type SloDef, type SloReport, type SloWindow } from './slo-core';

const BUCKET_COLS = [[5, 'le_5'], [10, 'le_10'], [25, 'le_25'], [50, 'le_50'], [100, 'le_100'], [250, 'le_250'], [500, 'le_500'],
  [1000, 'le_1000'], [2500, 'le_2500'], [5000, 'le_5000'], [10000, 'le_10000']] as const;

export function fastColumns(thresholdMs: number): string[] {
  const cols = BUCKET_COLS.filter(([ms]) => ms <= thresholdMs).map(([, c]) => c);
  if (!BUCKET_COLS.some(([ms]) => ms === thresholdMs)) throw new Error(`latency threshold ${thresholdMs} ms is not a bucket boundary`);
  return cols;
}

export async function readSlo(db: any, def: SloDef, now = new Date()): Promise<SloReport> {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const bad = def.kind === 'availability'
    ? sql`case when status_class = 5 then count else 0 end`
    : sql`count - (${sql.join(fastColumns(def.thresholdMs!).map((c) => sql.ref(c)), sql` + `)})`;
  const inScope = def.routes === '*' ? sql`true` : sql`(method || ' ' || route) in (${sql.join(def.routes.map((r) => sql`${r}`))})`;
  const win = (since: Date) => sql`coalesce(sum(count) filter (where bucket_minute >= ${since}), 0)::bigint`;
  const badIn = (since: Date) => sql`coalesce(sum(${bad}) filter (where bucket_minute >= ${since}), 0)::bigint`;
  const W = { window: ago(def.windowDays * 86_400_000), h6: ago(6 * 3_600_000), h1: ago(3_600_000), m30: ago(1_800_000), m5: ago(300_000) };
  const r = await sql<Record<string, string>>`
    select ${win(W.window)} t_w, ${badIn(W.window)} b_w, ${win(W.h6)} t_h6, ${badIn(W.h6)} b_h6, ${win(W.h1)} t_h1, ${badIn(W.h1)} b_h1,
           ${win(W.m30)} t_m30, ${badIn(W.m30)} b_m30, ${win(W.m5)} t_m5, ${badIn(W.m5)} b_m5
    from platform_request_metrics_minute
    -- The FILTERs bound each window; this WHERE only narrows the index range scan. Removing it changes no result
    -- (a mutation test confirmed it is equivalent), only how much of the table is read.
    where bucket_minute >= ${W.window} and ${inScope}`.execute(db);
  const row = r.rows[0] ?? {};
  const pair = (k: string): SloWindow => ({ total: Number(row[`t_${k}`] ?? 0), bad: Number(row[`b_${k}`] ?? 0) });
  return report(def, { window: pair('w'), h6: pair('h6'), h1: pair('h1'), m30: pair('m30'), m5: pair('m5') });
}

export async function readAllSlos(db: any, now = new Date()): Promise<SloReport[]> {
  const out: SloReport[] = [];
  for (const def of SLOS) out.push(await readSlo(db, def, now));
  return out;
}
