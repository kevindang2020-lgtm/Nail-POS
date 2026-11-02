// ai-queue-assignment.module.ts — wires the AI Queue Assignment layer (BUILD_PLAN Phase 6):
//   • QueueAssignmentCoreModule — the shared providers (engine service, the ONE settings source, ports) and the global
//     QUEUE_RECOMMENDER binding the queue boards use;
//   • the tenant engine routes here (recommend / decide / panel / rotation / auto) + the explanation service;
//   • QueueAssignmentOpsModule (Agent C) — alerts, overview, settings, analytics / exports, background jobs, the owner
//     branch comparison and the Super Admin oversight routes. It imports the core module too (no module cycle).
import { AiModule } from '../ai/ai.module';
import { AiPlatform } from '../ai/ai-platform';
import { queueExplainAdapter } from '../ai/ai-platform.adapters';
import { Module } from '@nestjs/common';
import { QueueAssignmentController } from './ai-queue-assignment.controller';
import type { QueueAssignmentRepositoryPort } from './ai-queue-assignment.repository';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import { QueueExplanationService } from './ai-queue-assignment-explanation.service';
import { QueueAssignmentCoreModule } from './ai-queue-assignment-core.module';
import { QueueAssignmentOpsModule } from './ai-queue-assignment-ops.module';

@Module({
  imports: [AiModule, QueueAssignmentCoreModule, QueueAssignmentOpsModule],
  controllers: [QueueAssignmentController],
  providers: [
    {
      provide: QueueExplanationService,
      // Constitution 10 §6: through the platform. The module keeps its own FEATURE toggle (ent) — a different
      // question from package entitlement, which the platform checks.
      useFactory: (repo: QueueAssignmentRepositoryPort, platform: AiPlatform, ent: QueueAssignmentEntitlementPort) =>
        new QueueExplanationService(repo, queueExplainAdapter(platform), ent),
      inject: ['QueueAssignmentRepositoryPort', AiPlatform, 'QueueAssignmentEntitlementPort'],
    },
  ],
  // Re-exporting the imported modules exports QueueAssignmentService, QUEUE_ASSIGNMENT_SETTINGS, QueueAlertService and
  // QueueOpsService (Nest refuses to export a provider token another module provides).
  exports: [QueueExplanationService, QueueAssignmentCoreModule, QueueAssignmentOpsModule],
})
export class QueueAssignmentModule {}
