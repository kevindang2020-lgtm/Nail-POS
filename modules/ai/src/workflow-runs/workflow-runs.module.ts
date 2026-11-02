import { Module } from '@nestjs/common';
import { WorkflowRunsController } from './workflow-runs.controller';
import { WorkflowRunsService } from './workflow-runs.service';
import { InMemoryWorkflowRunsRepo, type WorkflowRunsRepo } from './workflow-runs.repository';
import { KyselyWorkflowRunsRepo } from './workflow-runs.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

export const WORKFLOW_RUNS_REPO = Symbol('WORKFLOW_RUNS_REPO');

@Module({
  controllers: [WorkflowRunsController],
  providers: [
    { provide: WORKFLOW_RUNS_REPO, useFactory: (db: AppDatabase): WorkflowRunsRepo => (db ? new KyselyWorkflowRunsRepo(db) : new InMemoryWorkflowRunsRepo()), inject: [DATABASE] },
    { provide: WorkflowRunsService, useFactory: (repo: WorkflowRunsRepo) => new WorkflowRunsService(repo), inject: [WORKFLOW_RUNS_REPO] },
  ],
  exports: [WorkflowRunsService],
})
export class WorkflowRunsModule {}
