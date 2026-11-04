// job-telemetry-coverage.vitest.spec — Constitution 11 §192: EVERY in-process scheduler runs its tick through
// runJob(). This finds every OnModuleInit + setInterval class in src/ and fails if one calls its tick bare.
//
// Without this guard the 22nd scheduler is written the way the first 21 were: a setInterval with no job id, no
// context, no duration and no last-run record — invisible to the health aggregator until it silently stops.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) out.push(p); }
  return out;
}
// The job QUEUE runner (Phase 2) is not a scheduler, but it is an OnModuleInit with a setInterval (its reaper, which IS a
// scheduled tick and must use runTick). Its per-job runJob carries the JOB's type — a registered dotted name, enforced by
// the jobs.job_type CHECK and at enqueue/registration — so for this one file a runJob meta of `jobType: job.jobType` is
// the job's own stable name, not a per-tenant one, and not "a scheduled tick through runJob".
const QUEUE_RUNNER = 'jobs/job-worker.ts';
const QUEUE_JOB_META = /^\s*jobType:\s*job\.jobType\b/;
const schedulers = codeRoots().flatMap((r) => walk(r)).filter((f) => { const s = readFileSync(f, 'utf8'); return /implements .*OnModuleInit/.test(s) && /setInterval\(/.test(s); }).map((f) => relative(SRC, f));

describe('every scheduler is instrumented', () => {
  it('finds the schedulers at all — a guard that matches nothing guards nothing', () => {
    expect(schedulers.length).toBeGreaterThanOrEqual(21);
  });
  for (const f of schedulers) {
    it(`${f} runs its tick through runJob() — or runTick() when it is a background job`, () => {
      const s = readFileSync(join(SRC, f), 'utf8');
      // Every setInterval callback in the file must contain a runJob( or runTick( call.
      const bodies = [...s.matchAll(/setInterval\(\s*\(\)\s*=>\s*(\{[\s\S]*?\}|[^,]+),/g)].map((m) => m[1]);
      expect(bodies.length, `${f}: no setInterval callback found`).toBeGreaterThan(0);
      for (const b of bodies) expect(b.includes('runJob(') || b.includes('runTick('), `${f}: a setInterval callback calls its tick without runJob()/runTick()`).toBe(true);
    });
  }
  // Phase 2 (BUILD_PLAN_2026-10-06, migration 518): a BACKGROUND scheduler (one that asks runsBackgroundJob) runs each
  // tick through runTick, the fleet-wide lease — with two processes it otherwise ran every tick once per process.
  // Process-local timers (metrics flush, presence) do not ask runsBackgroundJob and keep runJob.
  const MULTI_OWNER_BY_DESIGN = new Set(['events/outbox-publisher.ts']);   // concurrent publishers claim rows with SKIP LOCKED
  it('every background scheduler ticks through runTick (single owner across processes)', () => {
    const background = codeRoots().flatMap((r) => walk(r)).filter((f) => { const s = readFileSync(f, 'utf8'); return /runsBackgroundJob\(/.test(s) && /set(?:Interval|Timeout)\(/.test(s) && !/export function runsBackgroundJob/.test(s) && !/\bmain\.ts$/.test(f); });
    // (a file that only ASKS runsBackgroundJob — e.g. the voice module's "is the sweep armed here?" health hint — owns no timer)
    expect(background.length).toBeGreaterThanOrEqual(30);
    const bare: string[] = [];
    for (const f of background) {
      const rel = relative(SRC, f); if (MULTI_OWNER_BY_DESIGN.has(rel)) continue;
      const s = readFileSync(f, 'utf8');
      const timers = [...s.matchAll(/set(?:Interval|Timeout)\(\s*\(\)\s*=>\s*(\{[\s\S]*?\}|[^,]+),/g)].map((m) => m[1]).filter((b) => /this\.|runJob\(|runTick\(/.test(b));
      if (!timers.some((b) => b.includes('runTick('))) bare.push(rel);
      const tickRunJobs = [...s.matchAll(/runJob\(\s*\{([^}]*)\}/g)].filter((m) => !(rel === QUEUE_RUNNER && QUEUE_JOB_META.test(m[1])));
      if (tickRunJobs.some((m) => /^\s*jobType/.test(m[1]))) bare.push(`${rel} (still calls runJob for a scheduled tick)`);
      if (/^\s*void this\.\w+\(\);/m.test(s)) bare.push(`${rel} (a first tick outside runTick)`);
    }
    expect(bare, bare.join('\n')).toEqual([]);
  });
  it('job types are stable dotted names, never per-tenant', () => {
    for (const f of schedulers) {
      const s = readFileSync(join(SRC, f), 'utf8');
      // Only the meta object passed to runJob() matters. An earlier version matched ANY `jobType:` in the file and
      // flagged the health aggregator for `{ jobType: j.jobType }` — a data mapping, not a job type built from a
      // variable. A guard that cries wolf on a namesake teaches people to ignore it, so it is scoped to runJob({…}).
      const metas = [...s.matchAll(/run(?:Job|Tick)\(\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((meta) => !(f === QUEUE_RUNNER && QUEUE_JOB_META.test(meta)));
      expect(metas.length, `${f}: no runJob/runTick({...}) call found`).toBeGreaterThan(0);
      for (const meta of metas) {
        const lit = /jobType:\s*'([^']+)'/.exec(meta);
        expect(lit, `${f}: runJob jobType is not a string literal (built from a variable?): ${meta.trim()}`).not.toBeNull();
        expect(lit![1], `${f}: ${lit![1]}`).toMatch(/^[a-z][a-z0-9_.]*$/);
      }
    }
  });
});
