// database.module.ts — BUILD_PLAN Phase 10 (agent E): wires the Super Admin Database page. The reads and the actions use
// the PRIMARY handle (activity, locks and the ledgers must be current; VACUUM and the retry are writes); the read handle
// is used only to ask a configured replica for its recovery state and lag. Agent B's constraint service is bound through
// DB_CONSTRAINT_RETRIER when the API provides it; otherwise the service's own shape-checked retry runs the ledger's
// retry_sql. Audits go through AuditSink (platform audit_logs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { DATABASE, DATABASE_READ, MIGRATIONS_DIR, type AppDatabase } from '@aipowersalon/database';
import { AuditService, auditSinkFor } from '@aipowersalon/audit';
import { SuperAdminDatabaseController } from './database.controller';
import { DatabaseOpsService, DB_CONSTRAINT_RETRIER, type DbConstraintRetrier } from './database.service';
import { KyselyDatabaseOpsRepository } from './database.repository';
import { DatabaseSizeSnapshotScheduler } from './database-snapshot.scheduler';
import { SlowQueryFlushScheduler, SlowQueryFlusher } from './slow-query-flush.scheduler';

/** Agent A's ownership registry (apps/api/db/ownership/registry.generated.json) when the process can read it. */
function registryTables(): Set<string> | null {
  try {
    const raw = JSON.parse(readFileSync(join(MIGRATIONS_DIR, '..', 'ownership', 'registry.generated.json'), 'utf8'));
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.tables) ? raw.tables : raw && typeof raw === 'object' ? Object.keys(raw.tables ?? raw) : [];
    const names = list.map((t: any) => (typeof t === 'string' ? t : t?.table ?? t?.name)).filter((t): t is string => typeof t === 'string');
    return names.length ? new Set(names) : null;
  } catch { return null; }
}
let cachedRegistry: Set<string> | null | undefined;

@Module({
  controllers: [SuperAdminDatabaseController],
  providers: [
    { provide: KyselyDatabaseOpsRepository, useFactory: (db: AppDatabase | null, read: AppDatabase | null) => (db ? new KyselyDatabaseOpsRepository(db, process.env.DATABASE_REPLICA_URL && read && read !== db ? read : null) : null),
      inject: [{ token: DATABASE, optional: true }, { token: DATABASE_READ, optional: true }] },
    {
      provide: DatabaseOpsService,
      useFactory: (repo: KyselyDatabaseOpsRepository | null, audit: AuditService | null, retrier: DbConstraintRetrier | null) => new DatabaseOpsService(repo, audit ? auditSinkFor(audit) : null, {
        migrationsDir: MIGRATIONS_DIR,
        replicaConfigured: !!process.env.DATABASE_REPLICA_URL,
        allowedTables: () => (cachedRegistry === undefined ? (cachedRegistry = registryTables()) : cachedRegistry),
      }, retrier ?? null),
      inject: [KyselyDatabaseOpsRepository, { token: AuditService, optional: true }, { token: DB_CONSTRAINT_RETRIER, optional: true }],
    },
    { provide: SlowQueryFlusher, useFactory: (repo: KyselyDatabaseOpsRepository | null) => new SlowQueryFlusher(repo), inject: [KyselyDatabaseOpsRepository] },
    DatabaseSizeSnapshotScheduler,
    SlowQueryFlushScheduler,
  ],
  exports: [DatabaseOpsService],
})
export class SuperAdminDatabaseModule {}
