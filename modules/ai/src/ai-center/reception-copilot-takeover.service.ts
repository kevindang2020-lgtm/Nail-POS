// reception-copilot-takeover.service.ts — human takeover of a live AI call (spec §24). The flow is fully implemented and
// tenant-safe; the only part that needs external credentials is the actual telephony redirect, which is a REAL Twilio
// integration behind the transfer port (honest "not configured" when creds are absent, never a fake success).
//
// Order of checks (all before any provider call): permission → active + owned (via tenant-scoped live-call state) →
// destination resolved → provider configured. On success: audit + clear active-call. On provider failure: audit the
// failure so a receptionist can follow up, and return CALL_TAKEOVER_FAILED (the AI stays in its existing fallback).
import { Injectable, Inject } from '@nestjs/common';
import { AuditService } from '@aipowersalon/audit';
import { ReceptionCopilotLiveStateService } from './reception-copilot-live-state.service';
import type { CallTransferPort } from './reception-copilot-call-transfer';
import type { CopilotCtx } from './reception-copilot-context.service';

export type TakeoverDestinationType = 'front_desk' | 'manager' | 'branch_queue' | 'custom';
export interface TakeoverResult { ok: boolean; status?: 'transferred'; errorCode?: string; message?: string; takenOverBy?: string; at?: string }

@Injectable()
export class ReceptionCopilotTakeoverService {
  constructor(
    @Inject('COPILOT_CALL_TRANSFER') private readonly transfer: CallTransferPort,
    private readonly liveState: ReceptionCopilotLiveStateService,
    private readonly audit: AuditService,
  ) {}

  private has(ctx: CopilotCtx, perm: string): boolean { return (ctx.permissions || []).includes(perm); }

  async takeOverCall(ctx: CopilotCtx, input: { providerCallId?: string; destination?: string; destinationType?: TakeoverDestinationType }): Promise<TakeoverResult> {
    // 1. Permission (§45).
    if (!this.has(ctx, 'reception_copilot.take_over_calls')) return { ok: false, errorCode: 'INSUFFICIENT_PERMISSION', message: 'You do not have permission to take over calls.' };
    if (!input.providerCallId) return { ok: false, errorCode: 'VALIDATION_ERROR', message: 'providerCallId is required.' };
    if (!input.destination) return { ok: false, errorCode: 'VALIDATION_ERROR', message: 'A takeover destination is required.' };

    // 2. Active + owned: the call must be active for THIS tenant. getActiveCall reads only this tenant's namespace, so a
    // call belonging to another tenant is unreachable and cannot be taken over.
    const active = await this.liveState.getActiveCall(ctx.tenantId, input.providerCallId);
    if (!active) return { ok: false, errorCode: 'CALL_NOT_ACTIVE', message: 'That call is not active for this salon.' };

    // 3. Provider configured? Honest status when telephony credentials are absent — no fake transfer.
    if (!this.transfer.configured()) return { ok: false, errorCode: 'CALL_TRANSFER_NOT_CONFIGURED', message: 'Live call transfer is not configured. Connect a telephony provider to enable takeover.' };

    // 4. Redirect the live call to the human destination.
    const r = await this.transfer.transfer({ providerCallId: input.providerCallId, destination: input.destination });
    if (!r.ok) {
      if (r.notConfigured) return { ok: false, errorCode: 'CALL_TRANSFER_NOT_CONFIGURED', message: 'Live call transfer is not configured.' };
      await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId } as any, {
        module: 'reception_copilot', action: 'call.takeover_failed', resourceType: 'voice_call', resourceId: input.providerCallId,
        summary: 'Human takeover of AI call failed', metadata: { source: 'RECEPTION_COPILOT', destinationType: input.destinationType ?? 'custom', error: r.error ?? null },
      }).catch(() => undefined);
      return { ok: false, errorCode: 'CALL_TAKEOVER_FAILED', message: r.error || 'The call could not be transferred. The AI remains in fallback; please follow up with the caller.' };
    }

    // 5. Success: audit + clear active-call state.
    const at = new Date().toISOString();
    await this.audit.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId } as any, {
      module: 'reception_copilot', action: 'call.taken_over', resourceType: 'voice_call', resourceId: input.providerCallId,
      summary: 'Human receptionist took over an AI call', metadata: { source: 'RECEPTION_COPILOT', destinationType: input.destinationType ?? 'custom', takenOverBy: ctx.userId },
    }).catch(() => undefined);
    await this.liveState.clearActiveCall(ctx.tenantId, input.providerCallId);
    return { ok: true, status: 'transferred', takenOverBy: ctx.userId, at };
  }
}
