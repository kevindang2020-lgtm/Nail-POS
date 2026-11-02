// database-indexes.warmup.ts — B-30 round 2 (Oct 20 2026): the Super Admin index report reads every index's definition and
// size; computed on the first request it took 3.1 s while other requests ran (third full run, route sweep). It is computed
// ONCE when a serving process starts — not awaited, never blocking start-up, a failure swallowed (the first request then
// computes it, single-flight) — and served from the 10-minute cache. Not a background job (one query, once): it runs in
// the processes that serve requests (PROCESS_ROLE all | api), never in a worker. Off with DB_INDEX_REPORT_WARMUP=off.
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { processRole } from '@aipowersalon/config';
import { DatabaseOpsService } from './database.service';

export function shouldWarmIndexReport(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.DB_INDEX_REPORT_WARMUP ?? '').trim().toLowerCase() === 'off') return false;
  return processRole(env) !== 'worker';
}

@Injectable()
export class DatabaseIndexesWarmup implements OnApplicationBootstrap {
  constructor(private readonly svc: DatabaseOpsService) {}
  onApplicationBootstrap(): void {
    if (!shouldWarmIndexReport()) return;
    void this.svc.warmIndexes();
  }
}
