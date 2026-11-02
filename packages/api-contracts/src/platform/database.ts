// database.ts — wire contract (Constitution 13 §13, §15). Realm: platform. The Super Admin Database page
// (BUILD_PLAN Phase 10, Constitution 1 §94–98): System Operations → Database. Read-only figures from the PostgreSQL
// catalogue and statistics views plus three audited actions (cancel a backend, VACUUM ANALYZE one table, retry a deferred
// constraint). There is NO "run SQL" surface (§98). Nothing here carries a credential, a connection string or a query
// parameter value: slow queries are SHAPES (parameters replaced by `$?`), activity rows carry the query's first 200
// characters with every literal replaced.

/** A section the server could not read (an absent extension, a view this role may not read) says so — never a fake zero. */
export interface DbUnavailable { available: false; reason: string }

export interface DbOverview {
  observedAt: string;
  server: { version: string; versionNum: number; uptimeSeconds: number | null };
  size: { databaseBytes: number; tableCount: number; indexCount: number };
  connections: { total: number; active: number; idle: number; idleInTransaction: number; waiting: number; max: number; utilisation: number };
  cacheHitRatio: number | null;                    // blocks hit / (hit + read) for this database, since stats reset
  deadlocks: number; tempBytes: number; statsResetAt: string | null;
  checkpoints: { timed: number; requested: number } | DbUnavailable;
  walBytes: number | null;                         // pg_current_wal_lsn() - '0/0' — grows without bound; the rate is in growth
  migrations: { latest: string | null; applied: number; files: number; pending: string[]; ledgerIntegrity: 'ok' | 'broken'; unknownLedgerRows: string[] };
  replica: { configured: boolean; inRecovery: boolean | null; lagSeconds: number | null; replicationSlots: number | null; standbys: Array<{ applicationName: string; state: string; replayLagSeconds: number | null }>; note: string | null };
  backups: { lastSuccessAt: string | null; lastStatus: string | null; pitrEnabled: boolean | null } | DbUnavailable;
  extensions: { pgStatStatements: boolean; pgTrgm: boolean; pgcrypto: boolean };
}

export interface DbTableRow {
  table: string; totalBytes: number; tableBytes: number; indexBytes: number; rowEstimate: number; deadTuples: number;
  deadRatio: number; seqScans: number; idxScans: number; lastVacuum: string | null; lastAutovacuum: string | null;
  lastAnalyze: string | null; lastAutoanalyze: string | null; bloatEstimateBytes: number;
}
export interface DbTables { observedAt: string; rows: DbTableRow[] }

export interface DbIndexRow { index: string; table: string; bytes: number; scans: number; definition: string }
export interface DbIndexes {
  observedAt: string; statsResetAt: string | null;
  /** B-30: the report is computed once per 10 minutes (it reads every index's definition and size) — when, and whether this answer came from the cache; `?refresh=1` recomputes */
  computedAt: string; cached: boolean;
  unused: DbIndexRow[];                            // idx_scan = 0, not a primary key / unique / exclusion constraint
  invalid: DbIndexRow[];                           // pg_index.indisvalid = false (an interrupted CONCURRENTLY build)
  duplicates: Array<{ table: string; definition: string; indexes: string[] }>;   // same table + columns + predicate
}

export interface DbSlowQueryRow { hash: string; shape: string; calls: number; meanMs: number; maxMs: number; totalMs: number; rows: number; lastSeenAt: string | null; table: string | null }
export interface DbSlowQueries { observedAt: string; source: 'pg_stat_statements' | 'app_telemetry'; note: string; rows: DbSlowQueryRow[] }

export interface DbActivityRow { pid: number; applicationName: string; state: string; waitEventType: string | null; waitEvent: string | null; xactSeconds: number | null; querySeconds: number | null; queryShape: string; backendType: string }
export interface DbLockWait { waitingPid: number; blockingPids: number[]; waitingSeconds: number | null; relation: string | null; mode: string | null }
export interface DbActivity {
  observedAt: string;
  byApplication: Array<{ applicationName: string; state: string; count: number }>;
  longTransactions: DbActivityRow[];               // xact open > 30 s
  idleInTransaction: DbActivityRow[];
  lockWaits: DbLockWait[];
}

export interface DbDeferredConstraint { id: string; name: string; table: string; kind: string; migration: string; reason: string; blockingRows: number | null; createdAt: string; retryable: boolean }
export interface DbSchemaHealth {
  observedAt: string;
  deferred: DbDeferredConstraint[];
  notValidConstraints: Array<{ table: string; name: string; type: 'foreign_key' | 'check' }>;
  backfills: Array<{ name: string; status: string; rowsDone: number; batchesDone: number; lastKey: string | null; updatedAt: string; lastError: string | null }>;
}

export interface DbRetentionRuns { observedAt: string; rows: Array<{ id: string; dataClass: string; mode: string; cutoff: string | null; eligible: number; affected: number; actorUserId: string | null; occurredAt: string }> }

export interface DbGrowth {
  observedAt: string; days: number;
  totals: Array<{ day: string; totalBytes: number }>;
  tables: Array<{ table: string; latestBytes: number; changeBytes: number; series: Array<{ day: string; totalBytes: number; rowEstimate: number }> }>;
}

/** Every action needs a reason (≥ 10 characters, audited) and step-up. */
export interface DbActionRequest { reason: string }
export interface DbCancelBackendResult { ok: true; pid: number; cancelled: boolean }
export interface DbVacuumResult { ok: true; table: string; durationMs: number }
export interface DbRetryConstraintResult { ok: true; id: string; resolved: boolean; message: string }
