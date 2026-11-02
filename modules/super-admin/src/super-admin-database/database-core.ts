// database-core.ts — BUILD_PLAN Phase 10 (agent E): the pure rules behind the Super Admin Database page
// (Constitution 1 §94–98). No I/O here; the repository reads PostgreSQL, this decides what the figures mean.
//
//   actionReason          every action (cancel a backend, VACUUM ANALYZE, retry a deferred constraint) needs a reason
//   isSafeTableName       VACUUM takes an identifier, never a string from the request: a plain identifier that ALSO
//                         exists in the catalogue (checked by the service) — and it is quoted with %I on top
//   migrationLedger       version = highest applied file; pending = files not in the ledger; a ledger row whose file is
//                         gone breaks integrity (a rename that was never reconciled, or a hand-edited ledger)
//   queryShape            what an activity row shows of a running query: every literal replaced (§97: no raw values)
//   retrySqlAllowed       the retry action runs the statement a migration's pre-flight recorded — and ONLY the statement
//                         shapes a pre-flight records (one statement; create index / validate / add constraint / alter
//                         column type or not null). This is not a "run SQL" button (§98): the text comes from the ledger
//                         a migration wrote, and anything else is refused.

export const MIN_DB_ACTION_REASON = 10;
export const MAX_DB_ACTION_REASON = 500;

export function actionReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const r = raw.trim();
  return r.length >= MIN_DB_ACTION_REASON ? r.slice(0, MAX_DB_ACTION_REASON) : null;
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
export function isSafeTableName(name: unknown): name is string {
  return typeof name === 'string' && IDENT.test(name);
}

export interface MigrationLedger { latest: string | null; applied: number; files: number; pending: string[]; ledgerIntegrity: 'ok' | 'broken'; unknownLedgerRows: string[] }
/** `files` null = the migrations directory is not readable in this process (then nothing can be called pending or broken). */
export function migrationLedger(files: string[] | null, ledger: string[]): MigrationLedger {
  const applied = [...new Set(ledger)].sort();
  const latest = applied.length ? applied[applied.length - 1] : null;
  if (!files) return { latest, applied: applied.length, files: 0, pending: [], ledgerIntegrity: 'ok', unknownLedgerRows: [] };
  const fileSet = new Set(files), appliedSet = new Set(applied);
  const pending = files.filter((f) => !appliedSet.has(f)).sort();
  const unknownLedgerRows = applied.filter((f) => !fileSet.has(f));
  return { latest, applied: applied.length, files: files.length, pending, ledgerIntegrity: unknownLedgerRows.length ? 'broken' : 'ok', unknownLedgerRows };
}

/** A running query as the page may show it: literals → `?` / `N`, parameters → `$?`, whitespace collapsed, ≤ 200 chars. */
export function queryShape(sqlText: string | null | undefined): string {
  if (typeof sqlText !== 'string') return '';
  return sqlText
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '?')        // dollar-quoted bodies
    .replace(/[eE]?'(?:[^']|'')*'/g, '?')                        // string literals (with '' escapes, E'' strings)
    .replace(/\$\d+/g, '$?')                                     // bind parameters
    .replace(/(?<![\w$.])\d+(?:\.\d+)?\b/g, 'N')                 // numeric literals — not digits inside identifiers
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** A cheap bloat estimate from the statistics the page already reads: the dead share of the heap. */
export function bloatEstimateBytes(tableBytes: number, liveTuples: number, deadTuples: number): number {
  const live = Math.max(0, Number(liveTuples) || 0), dead = Math.max(0, Number(deadTuples) || 0);
  if (live < 0 || dead <= 0 || live + dead === 0) return 0;
  return Math.round((Math.max(0, Number(tableBytes) || 0) * dead) / (live + dead));
}

/** The part of an index definition that decides what it indexes: name and CREATE stripped, UNIQUE kept. */
export function indexKey(definition: string): string {
  const m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|\S+)\s+/i.exec(definition);
  if (!m) return definition.trim();
  return `${m[1] ? 'UNIQUE ' : ''}${definition.slice(m[0].length).trim()}`;
}
export function duplicateIndexGroups(rows: Array<{ table: string; index: string; definition: string }>): Array<{ table: string; definition: string; indexes: string[] }> {
  const groups = new Map<string, { table: string; definition: string; indexes: string[] }>();
  for (const r of rows) {
    const key = indexKey(r.definition);
    const g = groups.get(`${r.table}\u0000${key}`) ?? { table: r.table, definition: key, indexes: [] };
    g.indexes.push(r.index);
    groups.set(`${r.table}\u0000${key}`, g);
  }
  return [...groups.values()].filter((g) => g.indexes.length > 1).map((g) => ({ ...g, indexes: g.indexes.sort() }))
    .sort((a, b) => a.table.localeCompare(b.table) || a.definition.localeCompare(b.definition));
}

const T = '(?:ONLY\\s+)?[a-z_][a-z0-9_]*';
const N = '[a-z_][a-z0-9_]*';
const RETRY_SHAPES: RegExp[] = [
  new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${N}\\s+ON\\s+${T}\\s*(?:USING\\s+[a-z]+\\s*)?\\([^;]*\\)(?:\\s+WHERE\\s+[^;]+)?$`, 'is'),
  new RegExp(`^ALTER\\s+TABLE\\s+${T}\\s+VALIDATE\\s+CONSTRAINT\\s+${N}$`, 'is'),
  new RegExp(`^ALTER\\s+TABLE\\s+${T}\\s+ADD\\s+CONSTRAINT\\s+${N}\\s+(?:CHECK|FOREIGN\\s+KEY|UNIQUE)\\b[^;]*$`, 'is'),
  new RegExp(`^ALTER\\s+TABLE\\s+${T}\\s+ALTER\\s+COLUMN\\s+${N}\\s+(?:(?:SET\\s+DATA\\s+)?TYPE\\s+[a-z]+(?:\\[\\])?(?:\\s+USING\\s+[^;]+)?|SET\\s+NOT\\s+NULL)$`, 'is'),
];
/** One statement of a shape a pre-flight records; no comments, no second statement, no server-function calls. */
export function retrySqlAllowed(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.trim().replace(/;\s*$/, '').trim();
  if (!s || s.includes(';') || /--|\/\*/.test(s)) return false;
  if (/\bpg_[a-z_]+\s*\(|\bdblink|\bcopy\b|\bselect\b|\bset_config\b|\bcurrent_setting\b|\blo_[a-z]+\s*\(/i.test(s)) return false;
  return RETRY_SHAPES.some((re) => re.test(s));
}
export const retryNeedsNoTransaction = (s: string): boolean => /\bCONCURRENTLY\b/i.test(s);

export interface SlowSample { hash: string; fingerprint: string; table: string | null; durationMs: number; rows: number; at: string | number | Date }
export function aggregateSlowSamples(samples: SlowSample[]) {
  const by = new Map<string, { hash: string; shape: string; calls: number; totalMs: number; maxMs: number; rows: number; last: number; table: string | null }>();
  for (const s of samples) {
    const at = new Date(s.at).getTime();
    const g = by.get(s.hash) ?? { hash: s.hash, shape: s.fingerprint, calls: 0, totalMs: 0, maxMs: 0, rows: 0, last: 0, table: s.table ?? null };
    g.calls += 1; g.totalMs += Number(s.durationMs) || 0; g.maxMs = Math.max(g.maxMs, Number(s.durationMs) || 0); g.rows += Number(s.rows) || 0;
    if (at > g.last) g.last = at;
    by.set(s.hash, g);
  }
  return [...by.values()].map((g) => ({ hash: g.hash, shape: g.shape, calls: g.calls, meanMs: Math.round(g.totalMs / g.calls), maxMs: g.maxMs, totalMs: g.totalMs, rows: g.rows, lastSeenAt: g.last ? new Date(g.last).toISOString() : null, table: g.table }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export interface SnapshotPoint { day: string; table: string; totalBytes: number; rowEstimate: number }
export function growthFromSnapshots(points: SnapshotPoint[], tableLimit: number) {
  const totals = new Map<string, number>();
  const tables = new Map<string, Array<{ day: string; totalBytes: number; rowEstimate: number }>>();
  for (const p of points) {
    totals.set(p.day, (totals.get(p.day) ?? 0) + Number(p.totalBytes));
    const s = tables.get(p.table) ?? []; s.push({ day: p.day, totalBytes: Number(p.totalBytes), rowEstimate: Number(p.rowEstimate) }); tables.set(p.table, s);
  }
  return {
    totals: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, totalBytes]) => ({ day, totalBytes })),
    tables: [...tables.entries()].map(([table, series]) => {
      series.sort((a, b) => a.day.localeCompare(b.day));
      const latest = series[series.length - 1].totalBytes;
      return { table, latestBytes: latest, changeBytes: latest - series[0].totalBytes, series };
    }).sort((a, b) => b.changeBytes - a.changeBytes || b.latestBytes - a.latestBytes).slice(0, Math.max(1, tableLimit)),
  };
}
