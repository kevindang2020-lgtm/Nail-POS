// db-constraint-retrier.module.ts — BUILD_PLAN Phase 10 (agent E): binds agent B's DbConstraintsService (the ONE place a
// deferred constraint's retry_sql is run: re-count the blocking rows from the catalogue, run it only when zero, mark it
// resolved) to the Super Admin Database page's retry action (DB_CONSTRAINT_RETRIER in @aipowersalon/super-admin).
// Global so the super-admin module (which may not import from apps/api) receives it by token.
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { DB_CONSTRAINT_RETRIER, type DbConstraintRetrier } from '@aipowersalon/super-admin';
import { DbConstraintsService, type RetryOutcome } from './db-constraints.service';

/** B's outcome → the page's { resolved, message }. Never carries row contents (B's errors are the first line only). */
export function retrierFor(svc: Pick<DbConstraintsService, 'retry'>): DbConstraintRetrier {
  return {
    async retry(id, actor) {
      const o: RetryOutcome = await svc.retry(id, actor.userId ? `super_admin:${actor.userId}` : 'super_admin');
      switch (o.status) {
        case 'resolved': return { resolved: true, message: `${o.name} applied on ${o.table}.` };
        case 'already_resolved': return { resolved: true, message: 'Already resolved.' };
        case 'still_blocked': return { resolved: false, message: `Still blocked: ${o.blockingRows} blocking row(s) on ${o.table}. Fix the data, then retry.` };
        case 'refused': return { resolved: false, message: 'Refused: the recorded statement is not one a migration writes — resolve it in a deployment.' };
        case 'not_found': return { resolved: false, message: 'Deferred constraint not found.' };
        default: return { resolved: false, message: `Failed: ${String((o as any).error ?? 'unknown error').split('\n')[0].slice(0, 200)}` };
      }
    },
  };
}

@Global()
@Module({
  providers: [{ provide: DB_CONSTRAINT_RETRIER, useFactory: (db: AppDatabase | null) => (db ? retrierFor(new DbConstraintsService(db)) : null), inject: [{ token: DATABASE, optional: true }] }],
  exports: [DB_CONSTRAINT_RETRIER],
})
export class DbConstraintRetrierModule {}
