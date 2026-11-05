// slo-validation.ts — BUILD_PLAN Phase 14 C (Constitution 11 §80): SLO validation hooks.
//
// §80: "Do not invent guaranteed values before load testing and production measurement." slo-core marks all five targets
// PROPOSED. This turns "proposed" into a VERDICT from production data, and only from production data:
//   proposed   fewer than SLO_VALIDATION_MIN_DAYS distinct UTC days with in-scope traffic in the SLO's window, or fewer
//              than SLO_VALIDATION_MIN_REQUESTS requests — not enough evidence either way;
//   validated  enough days AND enough requests, and the window's SLI met the target;
//   breached   enough evidence, and the SLI missed the target.
// The source is platform_request_metrics_minute — the per-minute table every API instance writes (kept 35 days, the
// window is 30). Nothing is seeded and nothing is assumed: an empty table is `proposed` with 0 days, forever, until real
// traffic arrives. The verdict is recomputed every run (a validated SLO can later be breached and vice versa); the first
// time each verdict is reached is kept (validated_at / breached_at). Fast burn is still the multi-window alert in
// slo-core / the aggregator (§106); this is the slow, evidence-based judgement of whether the target itself holds.
import { log as rootLog, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DATABASE, canMoveToSql, defineStateMachine } from '@aipowersalon/database';
import { utcDate } from '@aipowersalon/date-time';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { SLOS, type SloDef } from './slo-core';
import { fastColumns } from './slo-reader';
import type { SloValidation } from '@aipowersalon/api-contracts/platform';

const log = rootLog.withContext({ component: 'slo-validation' });
export const VALIDATE_EVERY_MS = 60 * 60_000;
export type Verdict = 'proposed' | 'validated' | 'breached';

const ALL = ['proposed', 'validated', 'breached'] as const;
/** slo_validations.status — recomputed from data every run, so any verdict may follow any other. */
export const SLO_VALIDATION = defineStateMachine({
  name: 'slo_validation', table: 'slo_validations', column: 'status',
  states: ['proposed', 'validated', 'breached'],
  transitions: Object.fromEntries(ALL.map((s) => [s, [...ALL]])) as any,
  initial: ['proposed', 'validated', 'breached'],
});

export function thresholds(env: Record<string, string | undefined> = process.env) {
  const days = Math.max(1, Math.floor(Number(env.SLO_VALIDATION_MIN_DAYS ?? 28)) || 28);
  const requests = Math.max(1, Math.floor(Number(env.SLO_VALIDATION_MIN_REQUESTS ?? 1000)) || 1000);
  return { minDays: days, minRequests: requests };
}

export interface DayRow { day: string; total: number; bad: number }
export interface Evaluation { verdict: Verdict; daysWithData: number; requiredDays: number; total: number; bad: number; sli: number | null }

/** Pure: the verdict for one SLO from its per-day rows (already limited to its window). */
export function evaluateSlo(def: Pick<SloDef, 'target' | 'windowDays'>, days: DayRow[], t = thresholds()): Evaluation {
  const withData = days.filter((d) => d.total > 0);
  const total = withData.reduce((a, d) => a + d.total, 0), bad = withData.reduce((a, d) => a + d.bad, 0);
  const requiredDays = Math.min(t.minDays, def.windowDays);
  const sli = total ? (total - bad) / total : null;
  const enough = withData.length >= requiredDays && total >= t.minRequests;
  const verdict: Verdict = !enough || sli === null ? 'proposed' : sli >= def.target ? 'validated' : 'breached';
  return { verdict, daysWithData: withData.length, requiredDays, total, bad, sli };
}

/** Per-UTC-day totals and bad counts for one SLO over its window, from the persisted per-minute table. */
export async function dailyRows(db: any, def: SloDef, now: Date): Promise<DayRow[]> {
  const since = new Date(now.getTime() - def.windowDays * 86_400_000);
  const bad = def.kind === 'availability'
    ? sql`case when status_class = 5 then count else 0 end`
    : sql`count - (${sql.join(fastColumns(def.thresholdMs!).map((c) => sql.ref(c)), sql` + `)})`;
  const inScope = def.routes === '*' ? sql`true` : sql`(method || ' ' || route) in (${sql.join(def.routes.map((r) => sql`${r}`))})`;
  const r = await sql<{ day: string; total: string; bad: string }>`
    select floor(extract(epoch from bucket_minute) / 86400)::bigint as day, sum(count)::bigint as total, sum(${bad})::bigint as bad
    from platform_request_metrics_minute where bucket_minute >= ${since} and bucket_minute < ${now} and ${inScope}
    group by 1 order by 1`.execute(db);
  // Platform-wide evidence, so the day is the epoch's UTC day (day number × 86 400 s) — not any salon's business day.
  return r.rows.map((x) => ({ day: utcDate(new Date(Number(x.day) * 86_400_000)), total: Number(x.total), bad: Number(x.bad) }));
}

export async function validateAll(db: any, now = new Date(), env: Record<string, string | undefined> = process.env): Promise<Array<{ id: string } & Evaluation>> {
  const t = thresholds(env); const out: Array<{ id: string } & Evaluation> = [];
  for (const def of SLOS) {
    const e = evaluateSlo(def, await dailyRows(db, def, now), t);
    await sql`insert into slo_validations (slo_id, status, target, window_days, required_days, days_with_data, total, bad, sli, evaluated_at, validated_at, breached_at, updated_at)
      values (${def.id}, ${e.verdict}, ${def.target}, ${def.windowDays}, ${e.requiredDays}, ${e.daysWithData}, ${e.total}, ${e.bad}, ${e.sli}, ${now},
              ${e.verdict === 'validated' ? now : null}, ${e.verdict === 'breached' ? now : null}, ${now})
      on conflict (slo_id) do update set status = excluded.status, target = excluded.target, window_days = excluded.window_days, required_days = excluded.required_days,
        days_with_data = excluded.days_with_data, total = excluded.total, bad = excluded.bad, sli = excluded.sli, evaluated_at = excluded.evaluated_at,
        validated_at = coalesce(slo_validations.validated_at, excluded.validated_at), breached_at = coalesce(slo_validations.breached_at, excluded.breached_at),
        updated_at = excluded.updated_at
      where ${canMoveToSql(SLO_VALIDATION, e.verdict, 'slo_validations')}`.execute(db);
    out.push({ id: def.id, ...e });
  }
  return out;
}

/** The wire type is the contract's (Constitution 13 §15 — no mirrored API types). */
export type SloValidationView = SloValidation;

/** For System Operations: every SLO, with its last verdict — `proposed` with 0 days when it was never evaluated. */
export async function readSloValidations(db: any): Promise<SloValidationView[]> {
  const rows = (await sql<any>`select slo_id, status, required_days, days_with_data, total, bad, sli, evaluated_at, validated_at, breached_at from slo_validations`.execute(db)).rows;
  const by = new Map(rows.map((r: any) => [r.slo_id, r]));
  const t = thresholds();
  const iso = (d: any) => (d ? new Date(d).toISOString() : null);
  return SLOS.map((d) => {
    const r: any = by.get(d.id);
    return { id: d.id, name: d.name, status: (r?.status ?? 'proposed') as Verdict, target: d.target, windowDays: d.windowDays,
      requiredDays: r ? Number(r.required_days) : Math.min(t.minDays, d.windowDays), daysWithData: r ? Number(r.days_with_data) : 0,
      total: r ? Number(r.total) : 0, bad: r ? Number(r.bad) : 0, sli: r?.sli ?? null,
      evaluatedAt: iso(r?.evaluated_at), validatedAt: iso(r?.validated_at), breachedAt: iso(r?.breached_at) };
  });
}

@Injectable()
export class SloValidationJob implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void runTick({ jobType: 'slo.validate', jobClass: 'standard', everyMs: VALIDATE_EVERY_MS }, () => this.run()).catch(() => undefined); }, VALIDATE_EVERY_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  async run(now = new Date()) {
    if (!this.db) return [];
    try {
      const r = await validateAll(this.db, now);
      for (const v of r) if (v.verdict === 'breached') log.warn('slo.validation_breached', { slo: v.id, sli: v.sli, days: v.daysWithData });
      return r;
    } catch (e) { log.error('slo.validation_failed', { error: (e as Error).message }); return []; }
  }
}
