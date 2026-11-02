// ai-scheduling-ops.wiring.vitest.spec — BUILD_PLAN Phase 7 (agent B): the operations half wires into AiSchedulingModule
// (one injector with the engine) and the options bridge reaches OTHER modules: the AI receptionist (VoiceBookingModule)
// and the Reception Copilot (AiCenterModule) get the engine's findOptions without importing the optimizer module.
// Boots the real Nest modules with the app's global tokens stubbed (no database: every store falls back honestly).
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DATABASE, DATABASE_READ } from '@aipowersalon/database';
import { AiSchedulingModule } from './ai-scheduling.module';
import { AiSchedulingService } from './ai-scheduling.service';
import { VoiceBookingModule } from '../voice-booking/voice-booking.module';
import { VoiceBookingService } from '../voice-booking/voice-booking.service';
import { AiCenterModule } from '../ai-center/ai-center.module';
import { ReceptionCopilotContextService } from '../ai-center/reception-copilot-context.service';
import { ScheduleProposalService } from './ai-scheduling-proposals';
import { SchedAutomationRunner } from './ai-scheduling-automation';
import { SchedExplanationService } from './ai-scheduling-explanation';
import { SchedUsageService } from './ai-scheduling-usage';
import { SchedPlatformSwitch } from './ai-scheduling-ops.platform-switch';
import { SCHED_PROPOSAL_PORT, SCHED_AUTOMATION_PORT, SCHED_EXPLANATION_PORT, SCHED_USAGE_PORT, SCHED_PLATFORM_SWITCH_PORT } from './ai-scheduling.ports';
import { SCHED_ENGINE } from './ai-scheduling-ops.common';

@Global() @Module({
  providers: [{ provide: DATABASE, useValue: null }, { provide: DATABASE_READ, useValue: null }, { provide: 'TENANT_CACHE', useValue: null }, { provide: 'PROVIDER_SECRETS', useValue: null }, { provide: 'REALTIME_EMITTER', useValue: null }],
  exports: [DATABASE, DATABASE_READ, 'TENANT_CACHE', 'PROVIDER_SECRETS', 'REALTIME_EMITTER'],
})
class AppGlobals {}

describe('Phase 7 operations wiring (Nest)', () => {
  it('ports are the ops implementations; the engine resolves lazily; receptionist + copilot get the bound finder', async () => {
    @Module({ imports: [AppGlobals, AiSchedulingModule, VoiceBookingModule, AiCenterModule] }) class Root {}
    const app = await NestFactory.createApplicationContext(Root, { logger: false });
    try {
      expect(app.get(SCHED_PROPOSAL_PORT, { strict: false })).toBeInstanceOf(ScheduleProposalService);
      expect(app.get(SCHED_AUTOMATION_PORT, { strict: false })).toBeInstanceOf(SchedAutomationRunner);
      expect(app.get(SCHED_EXPLANATION_PORT, { strict: false })).toBeInstanceOf(SchedExplanationService);
      expect(app.get(SCHED_USAGE_PORT, { strict: false })).toBeInstanceOf(SchedUsageService);
      expect(app.get(SCHED_PLATFORM_SWITCH_PORT, { strict: false })).toBeInstanceOf(SchedPlatformSwitch);
      const engine: any = app.get(SCHED_ENGINE, { strict: false });
      const real = app.get(AiSchedulingService, { strict: false });
      expect(typeof engine.findOptions).toBe('function');
      expect((engine as any).e()).toBe(real);                         // the lazy ref is the module's ONE engine
      const voice: any = app.get(VoiceBookingService, { strict: false });
      const copilot: any = app.get(ReceptionCopilotContextService, { strict: false });
      expect(voice.finder?.bound()).toBe(true);
      expect(copilot.finder?.bound()).toBe(true);
      expect(voice.finder).toBe(copilot.finder);                       // one global bridge
    } finally { await app.close(); }
  }, 60_000);

  it('without the optimizer module the receptionist has no finder and keeps the booking path', async () => {
    @Module({ imports: [AppGlobals, VoiceBookingModule] }) class Root {}
    const app = await NestFactory.createApplicationContext(Root, { logger: false });
    try { expect((app.get(VoiceBookingService, { strict: false }) as any).finder).toBeNull(); } finally { await app.close(); }
  }, 60_000);
});
