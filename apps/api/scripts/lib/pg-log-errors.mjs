// pg-log-errors.mjs — the PostgreSQL server log as a proof: every ERROR one database logged during a run (wave 4).
// Code that wraps a query in `.catch(() => …)` turns a broken query into an empty read or a lost write; the client never
// sees it, but PostgreSQL logs it. live-route-sweep.mjs and live-pilot-day.mjs read the log after their run and fail on
// any ERROR that is not an expected outcome (a refused duplicate, an append-only refusal, a lock the script provokes).
// Returns null when the log is not readable here (the caller reports SKIP), else [{ msg, stmt, n }] grouped.
import { readdirSync, readFileSync } from 'node:fs';

export const PG_LOG_DIR = '/var/log/postgresql';

/** @param {{ dbName: string, since: Date, excludePids?: number[], expected?: RegExp, dir?: string }} o */
export function pgLogErrors({ dbName, since, excludePids = [], expected = null, dir = PG_LOG_DIR }) {
  let files; try { files = readdirSync(dir).filter((f) => /\.log$/.test(f)).map((f) => `${dir}/${f}`); } catch { return null; }
  const skipPid = new Set(excludePids.map(Number));
  const out = new Map();
  for (const f of files) {
    let lines; try { lines = readFileSync(f, 'utf8').split('\n'); } catch { return null; }
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\S+ \S+) UTC \[(\d+)\] \S*@(\S+) ERROR:\s+(.*)$/.exec(lines[i]);
      if (!m || m[3] !== dbName || skipPid.has(Number(m[2])) || new Date(m[1] + 'Z') < since) continue;
      const msg = m[4].replace(/ at character \d+/, '');
      if (expected && expected.test(msg)) continue;
      const stmt = lines.slice(i + 1, i + 4).map((l) => /STATEMENT:\s+(.*)$/.exec(l)?.[1]).find(Boolean) ?? '';
      const k = msg + '|' + stmt.slice(0, 80);
      const e = out.get(k) ?? { msg, stmt, n: 0 }; e.n++; out.set(k, e);
    }
  }
  return [...out.values()];
}
