// ai-scheduling-ops.bridge.ts — BUILD_PLAN Phase 7 (agent B): how the AI receptionist (voice-booking) and the Reception
// Copilot (ai-center) reach the optimizer's findOptions WITHOUT importing AiSchedulingModule.
//
// Why a bridge: VoiceBookingModule / AiCenterModule would have to import the whole optimizer module (and its booking /
// forecasting imports) for one method, and the optimizer's ops half may itself one day read from them — a module cycle.
// So: a tiny @Global module (imported once, by AiSchedulingModule through SCHED_OPS_IMPORTS) provides the narrow token
// SCHED_OPTIONS_FINDER; AiSchedulingModule binds the engine into it at startup. A consumer injects the token @Optional:
// in a process without the optimizer the token is absent (or unbound) and the consumer keeps its booking-availability
// path. Nothing here holds state beyond the one bound engine reference.
import { Global, Module } from '@nestjs/common';
import type { SchedOptionsRequest, SchedOptionsResponse } from '@aipowersalon/api-contracts/tenant';
import type { SchedCtx } from './ai-scheduling.ports';
import type { SchedEngine } from './ai-scheduling-ops.common';

export const SCHED_OPTIONS_FINDER = 'SchedOptionsFinder';
export interface SchedOptionsFinder {
  bound(): boolean;
  findOptions(ctx: SchedCtx, req: SchedOptionsRequest): Promise<SchedOptionsResponse>;
}

export class SchedOptionsBridge implements SchedOptionsFinder {
  private engine: Pick<SchedEngine, 'findOptions'> | null = null;
  bind(engine: Pick<SchedEngine, 'findOptions'>): void { this.engine = engine; }
  bound(): boolean { return !!this.engine; }
  findOptions(ctx: SchedCtx, req: SchedOptionsRequest): Promise<SchedOptionsResponse> {
    if (!this.engine) return Promise.reject(new Error('SCHED_OPTIONS_NOT_BOUND'));
    return this.engine.findOptions(ctx, req);
  }
}

@Global()
@Module({ providers: [{ provide: SCHED_OPTIONS_FINDER, useFactory: () => new SchedOptionsBridge() }], exports: [SCHED_OPTIONS_FINDER] })
export class SchedOptionsBridgeModule {}
