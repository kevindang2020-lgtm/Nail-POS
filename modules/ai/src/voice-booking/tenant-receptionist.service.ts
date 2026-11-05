// tenant-receptionist.service.ts — the tenant-facing AI Receptionist overview (Command Center data). Reuses the REAL
// backend that already exists: VoiceCallOutcomeService (call analytics), VoiceKeyService (whether an integration key
// has been issued), VoiceBranchInfoService (store hours → business-setup readiness), and the write-tools flag. Scope
// is server-derived (tenant/branch from the session), never the client. Everything is honest: providers report their
// true not-yet-connected state (no Retell/Twilio account is wired), and analytics rates stay null until real calls
// exist. This is the read layer for the pos-web AI Receptionist workspace; provisioning/live-provider actions are a
// later phase gated on real accounts.
import type { ChecklistItem, ReceptionistOverview, ChecklistState, ReceptionistProviders } from '@aipowersalon/api-contracts/tenant';
export type { ChecklistItem, ReceptionistOverview, ChecklistState, ReceptionistProviders };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable } from '@nestjs/common';
import { VoiceCallOutcomeService } from './voice-call-outcome.service';
import type { VoiceAnalytics } from './voice-analytics-core';
import { VoiceKeyService } from './voice-key.service';
import { VoiceBranchInfoService } from './voice-idempotency.service';
import { voiceWriteToolsEnabled } from './voice-tools';
import { resolveVoiceProvider, resolveTelephonyProvider, type ProviderState } from './provider-ports';

export interface ReceptionistCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }



@Injectable()
export class TenantReceptionistService {
  constructor(
    private readonly outcomes: VoiceCallOutcomeService,
    private readonly keys: VoiceKeyService,
    private readonly branchInfo: VoiceBranchInfoService,
  ) {}

  async overview(ctx: ReceptionistCtx): Promise<ReceptionistOverview> {
    const [analytics, keyRows, hours] = await Promise.all([
      this.outcomes.summary(ctx.tenantId, { branchId: ctx.branchId ?? undefined }),
      this.keys.list(ctx.tenantId).catch(() => []),
      this.branchInfo.storeHours(ctx as any).catch(() => null),
    ]);
    const keyIssued = (keyRows ?? []).some((k: any) => !k.revokedMs);
    const writeToolsEnabled = voiceWriteToolsEnabled(process.env);
    const hoursConfigured = !!hours && Object.values(hours.storeHours ?? {}).some((d: any) => d?.isOpen);

    // Provider status comes from the real provider seam (credential-derived), not a hardcoded literal. With no live
    // adapter and no accounts configured, this honestly reports not_connected with a specific reason.
    const voice = resolveVoiceProvider(process.env).status();
    const tel = resolveTelephonyProvider(process.env).status();
    const providers: ReceptionistProviders = { voiceAgent: voice.state, telephony: tel.state, voiceAgentDetail: voice.detail, telephonyDetail: tel.detail };

    const checklist: ChecklistItem[] = [
      { key: 'business_setup', label: 'Confirm business hours & services', state: hoursConfigured ? 'done' : 'action_needed', detail: hoursConfigured ? 'Store hours are configured.' : 'Set your store hours in Business Setup.' },
      { key: 'booking_rules', label: 'Confirm booking rules', state: 'pending', detail: 'Review booking rules used by the receptionist.' },
      { key: 'integration_key', label: 'Issue an integration key', state: keyIssued ? 'done' : 'action_needed', detail: keyIssued ? 'A voice integration key has been issued.' : 'An admin issues a vk_ key for the voice provider.' },
      { key: 'voice_agent', label: 'Create the voice agent', state: 'action_needed', detail: 'Connect a Retell account and create the AI Front Desk agent.' },
      { key: 'phone_number', label: 'Connect a phone number', state: 'action_needed', detail: 'Connect a Twilio number and route it to the agent.' },
      { key: 'write_tools', label: 'Arm booking actions', state: writeToolsEnabled ? 'done' : 'pending', detail: writeToolsEnabled ? 'Booking actions are armed.' : 'Booking actions run in handoff-only mode until armed.' },
      { key: 'test_call', label: 'Run a test call', state: 'pending', detail: 'Place a test call once the agent and number are connected.' },
      { key: 'go_live', label: 'Activate the receptionist', state: 'pending', detail: 'Go live after a successful test call.' },
    ];
    const done = checklist.filter((c) => c.state === 'done').length;
    const setupProgressPct = Math.round((done / checklist.length) * 100);

    const frontDeskStatus: ReceptionistOverview['frontDeskStatus'] =
      providers.voiceAgent === 'connected' && providers.telephony === 'connected' && writeToolsEnabled ? 'live'
      : hoursConfigured && keyIssued ? 'ready'
      : 'setup';

    return { frontDeskStatus, writeToolsEnabled, keyIssued, providers, analytics, checklist, setupProgressPct };
  }

  /** Recent calls for this tenant (real call-outcome rows), server-scoped. */
  async recentCalls(ctx: ReceptionistCtx, limit = 20) {
    return this.outcomes.list(ctx.tenantId, { branchId: ctx.branchId ?? undefined, limit: Math.min(Math.max(limit, 1), 50) });
  }

  /** Full outcome record for one call. Honest: transcript/recording are not stored, so the UI shows those as unavailable. */
  async callDetail(ctx: ReceptionistCtx, providerCallId: string) {
    const rec = await this.outcomes.get(ctx.tenantId, providerCallId);
    return rec ?? null;
  }
}
