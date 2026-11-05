// utc-clock.ts — the API and the worker run on UTC, whatever the host is set to (Oct 6 2026).
//
// About 140 places in server code use the process's local date methods (setMonth, getDate, toLocaleDateString without a
// zone, node-postgres reading DATE columns as local midnight). Production (Railway) and CI happen to run in UTC, so those
// are right today — but a host set to New York time shifted membership renewals by the daylight-saving hour, dated a
// renewal reminder a day early and billed 5 invoices instead of 6 (found Oct 2026, DUAL_SCREEN_DISPLAY_AUDIT Part D).
// A salon's own day never comes from here: every salon-facing count uses the BRANCH's zone (Unit 9).
//
// Imported FIRST by main.ts and worker.ts (pinned by utc-clock.vitest.spec.ts), before any module reads the clock.
// Node re-reads process.env.TZ when it is assigned, so this takes effect at once.

/** Puts the process on UTC; returns the zone it had, if any. */
export function pinUtc(env: NodeJS.ProcessEnv = process.env): { was: string | undefined } {
  const was = env.TZ;
  env.TZ = 'UTC';
  return { was };
}

const { was } = pinUtc();
if (was && !/^(Etc\/)?(UTC|UCT|Universal|Zulu|GMT)$/i.test(was)) {
  console.warn(`[clock] TZ was "${was}"; this process runs in UTC (salon days use each branch's own zone).`);
}
