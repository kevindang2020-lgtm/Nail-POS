import { api } from './client';
import type {
  DbActivity, DbCancelBackendResult, DbGrowth, DbIndexes, DbOverview, DbRetentionRuns, DbRetryConstraintResult, DbSchemaHealth, DbSlowQueries, DbTables, DbVacuumResult,
} from '@aipowersalon/api-contracts/platform';

// superAdminDatabaseApi — BUILD_PLAN Phase 10 (Constitution 1 §94–98): System Operations → Database. Reads need
// super_admin.database.view; the three actions need super_admin.database.manage, a reason (≥ 10 characters, audited) and
// step-up (the client re-prompts on 403 STEP_UP_REQUIRED and retries once). There is no SQL input anywhere.
export type {
  DbActivity, DbGrowth, DbIndexes, DbOverview, DbRetentionRuns, DbSchemaHealth, DbSlowQueries, DbTables,
} from '@aipowersalon/api-contracts/platform';

const P = '/super-admin/database';
export const superAdminDatabaseApi = {
  overview: () => api.get<DbOverview>(`${P}/overview`),
  tables: (limit = 50) => api.get<DbTables>(`${P}/tables`, { limit }),
  indexes: () => api.get<DbIndexes>(`${P}/indexes`),
  slowQueries: () => api.get<DbSlowQueries>(`${P}/slow-queries`),
  activity: () => api.get<DbActivity>(`${P}/activity`),
  schemaHealth: () => api.get<DbSchemaHealth>(`${P}/schema-health`),
  retentionRuns: (limit = 50) => api.get<DbRetentionRuns>(`${P}/retention-runs`, { limit }),
  growth: (days = 90) => api.get<DbGrowth>(`${P}/growth`, { days }),
  snapshotNow: () => api.post<{ ok: true; written: number }>(`${P}/snapshots`, {}),
  cancelBackend: (pid: number, reason: string) => api.post<DbCancelBackendResult>(`${P}/backends/${encodeURIComponent(String(pid))}/cancel`, { reason }),
  vacuumAnalyze: (table: string, reason: string) => api.post<DbVacuumResult>(`${P}/tables/${encodeURIComponent(table)}/vacuum-analyze`, { reason }),
  retryDeferred: (id: string, reason: string) => api.post<DbRetryConstraintResult>(`${P}/deferred-constraints/${encodeURIComponent(id)}/retry`, { reason }),
};
