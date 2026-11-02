// worker.ts — the background-worker entry point (Constitution 13 Phase 8, §60–61, §238, §288).
//
// Same codebase, same image, a second entry point: it boots the SAME Nest graph as the API as an application CONTEXT —
// no HTTP server — so every module's schedulers start exactly where PROCESS_ROLE / WORKER_JOB_CLASSES allow and nowhere
// else. It receives no requests, carries no business logic of its own (section 62: the jobs are the modules' own), and
// needs no Super Admin credentials (section 366).
//
//   node dist/worker.js                                   → every job class
//   WORKER_JOB_CLASSES=critical,reconciliation node dist/worker.js
//
// Run the web process with PROCESS_ROLE=api beside it, or both jobs will run twice. The default PROCESS_ROLE=all keeps
// today's single-process deploy (the API runs everything) until the split is made.
import './common/utc-clock';   // FIRST: the process runs in UTC before anything reads the clock
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { processRole, workerJobClasses } from '@aipowersalon/config';
import { PinoLoggerService } from '@aipowersalon/observability/nest';
import { assertProductionConfig } from './common/production-config';
import { AppModule } from './app.module';

/** The role this entry point runs as: 'worker' unless set; 'api' is refused — a worker that runs nothing is a mistake. */
export function workerRole(env: NodeJS.ProcessEnv = process.env): { classes: readonly string[] } {
  if (env.PROCESS_ROLE === undefined || env.PROCESS_ROLE === '') env.PROCESS_ROLE = 'worker';
  const role = processRole(env);
  if (role === 'api') throw new Error("the worker entry point cannot run with PROCESS_ROLE=api (it would run no job); use 'worker'");
  return { classes: role === 'all' ? ['all'] : workerJobClasses(env) };
}

async function bootstrap() {
  const { classes } = workerRole();
  assertProductionConfig();
  const ctx = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  if (process.env.NODE_ENV === 'production') ctx.useLogger(new PinoLoggerService());
  ctx.enableShutdownHooks();   // SIGTERM → every scheduler's onModuleDestroy clears its timer
  console.log(`[worker] started — PROCESS_ROLE=${process.env.PROCESS_ROLE}, job classes: ${classes.join(', ')}`);
}

if (require.main === module) void bootstrap();
