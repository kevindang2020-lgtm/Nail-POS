// jobs.module.ts — the job queue's worker (every process that runs a job class) and Super Admin's queue screen API.
import { Module } from '@nestjs/common';
import { AuditModule } from '@aipowersalon/audit';
import { JobWorkerService } from './job-worker';
import { JobsController } from './jobs.controller';

@Module({ imports: [AuditModule], controllers: [JobsController], providers: [JobWorkerService], exports: [JobWorkerService] })
export class JobsModule {}
