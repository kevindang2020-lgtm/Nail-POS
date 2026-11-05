// super-admin-ai-scheduling-optimizer.module.ts — BUILD_PLAN Phase 7 (agent B): wires the Super Admin oversight of the AI
// Scheduling Optimizer. Reads + the platform switch go through KyselySaSchedRead (primary database: the switch and the
// audit rows are writes, and the support-session check must see a session opened a second ago). Retry / rollback /
// disable go through the optimizer's own service (AiSchedulingModule exports AiSchedulingService) behind the narrow
// SaSchedEngine port. SuperAdminGuard on the controller is the auth boundary.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AiSchedulingModule, AiSchedulingService } from '@aipowersalon/ai';
import { SuperAdminAiSchedulingOptimizerController } from './super-admin-ai-scheduling-optimizer.controller';
import { SuperAdminAiSchedulingOptimizerService, SA_SCHED_ENGINE, type SaSchedEngine } from './super-admin-ai-scheduling-optimizer.service';
import { KyselySaSchedRead } from './super-admin-ai-scheduling-optimizer.repository';

@Module({
  imports: [AiSchedulingModule],
  controllers: [SuperAdminAiSchedulingOptimizerController],
  providers: [
    { provide: SA_SCHED_ENGINE, useFactory: (svc: unknown): SaSchedEngine | null => (svc ? (svc as SaSchedEngine) : null), inject: [{ token: AiSchedulingService, optional: true }] },
    {
      provide: SuperAdminAiSchedulingOptimizerService,
      useFactory: (db: AppDatabase | null, engine: SaSchedEngine | null) => new SuperAdminAiSchedulingOptimizerService(db ? new KyselySaSchedRead(db as any) : null, engine),
      inject: [{ token: DATABASE, optional: true }, SA_SCHED_ENGINE],
    },
  ],
  exports: [SuperAdminAiSchedulingOptimizerService],
})
export class SuperAdminAiSchedulingOptimizerModule {}
