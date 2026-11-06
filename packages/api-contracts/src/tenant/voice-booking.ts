// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface ChecklistItem { key: string; label: string; state: ChecklistState; detail: string }

export interface ReceptionistOverview {
  frontDeskStatus: 'setup' | 'ready' | 'live' | 'paused';
  writeToolsEnabled: boolean;
  keyIssued: boolean;
  providers: ReceptionistProviders;
  analytics: VoiceAnalytics;
  checklist: ChecklistItem[];
  setupProgressPct: number;
}

export interface ReceptionistSettings {
  enabled: boolean;
  defaultLanguage: string;
  afterHoursBehavior: 'ai_answers' | 'handoff' | 'voicemail';
  allowInterruptions: boolean;
  silenceTimeoutSeconds: number;
  maxCallDurationSeconds: number;
  recordingEnabled: boolean;
  recordingConsentMessage: string;
}

/** A9 Nov 6: Check Receptionist Settings (read-only, recorded) */
export interface ReceptionistSettingsCheckResult {
  overall: 'READY' | 'WARNING' | 'FAILED';
  checks: { id: string; label: string; state: 'READY' | 'WARNING' | 'FAILED'; detail: string; remedy: string | null }[];
  checkedAt: string; runId: string | null; recorded: boolean;
}
export interface ReceptionistSettingsLastCheck { id: string; overall: string; checks: unknown[]; at: string }
/** settings with where they came from, and whether the recording notice is owner-approved */
export type ReceptionistSettingsWithMeta = ReceptionistSettings & { meta?: { version: number; source: string; scope: string; appliedToCalls: false;
  consent?: { approved: boolean; approvedAt: string | null; approvedBy: string | null; supported: boolean } } };

export interface ProvisioningJob {
  id: string; tenantId: string; agentId: string; status: 'pending' | 'running' | 'succeeded' | 'failed';
  currentStep: string | null; currentStepLabel: string | null; progress: number;
  errorCode: string | null; safeErrorMessage: string | null; providerAgentId: string | null;
}

export type ChecklistState = 'done' | 'pending' | 'action_needed';

export interface ReceptionistProviders { voiceAgent: ProviderState; telephony: ProviderState; voiceAgentDetail: string; telephonyDetail: string }

export interface VoiceAnalytics {
  totalCalls: number;
  booked: number;
  bookingRatePct: number | null;      // booked / total
  handoffs: number;
  handoffRatePct: number | null;
  abandoned: number;
  abandonmentRatePct: number | null;
  callsWithToolFailure: number;
  toolFailureRatePct: number | null;
  followUpsNeeded: number;
  avgDurationSeconds: number | null;   // over calls that reported a duration
  topIntents: { intent: string; count: number }[];
}

export type ProviderState = 'connected' | 'not_connected' | 'error';
