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

/** A12 Nov 6: Business Setup — holiday / special-hours exceptions, FAQ tags, recorded health runs */
export interface BusinessClosure { id: string; date: string; scope: 'salon' | 'branch'; closed: boolean; opensAt: string | null; closesAt: string | null; note: string | null; createdAt: string | null }
export interface BusinessClosureList { timezone: string; items: BusinessClosure[] }
export interface BusinessClosureSaved { id: string; removed?: boolean }
export interface FaqTagsResult { id: string; tags: string[] }
export interface BusinessSetupHealthRun { id: string; overall: string; checks: unknown[]; at: string | null }

/** A13 Nov 6: AI Follow-Ups — more sources, recommended assignee, health history */
export interface FollowUpImportResult { createdFromMissedCalls: number; createdFromCopilot: number }
export interface FollowUpRecommendedAssignee { userId: string; name: string; role: string; openTasks: number; reason: string }
/** round 10 (AI Follow Ups 02): the location's overdue-callback manager alert — on/off and minutes of grace after the due time */
export interface FollowUpAlertSettings { enabled: boolean; graceMinutes: number; scope: 'branch' | 'tenant' | 'default'; updatedAt: string | null }
/** round 10 (AI Follow Ups 06): a shift handover — how many of my open follow-ups moved, and to whom */
export interface FollowUpHandoverResult { moved: number; toUserId: string; followUpIds: string[] }
export interface FollowUpHealthHistory { items: { overall: string; at: string | null; by: string | null; failed: number }[]; page: number; pageSize: number; totalItems: number; totalPages: number }
export interface BusinessSetupHealthResult { overall: string; checkedAt: string; runId: string | null; checks: unknown[]; note: string }

/** A17 Nov 6: Reviews — assignment, staff list, recorded checks */
export interface ReviewAssignResult { id: string; assignedUserId: string | null }
export interface ReviewStaffList { items: { id: string; name: string; role: string }[] }
export interface ReviewCheckRun { id: string; overall: string; checks: unknown[]; at: string | null }
export interface ReviewCheckResult { overall: string; checks: unknown[]; checkedAt: string }

/** A18 Nov 6: Referral Program — recorded checks and filter options */
export interface ReferralHealthRun { id: string; overall: string; items: unknown[]; at: string | null }
export interface ReferralHealthResult { overall: string; items: unknown[]; errors: Record<string, string>; checkedAt: string; mutating: boolean; runId: string | null }
export interface ReferralFilterOptions { creators: { id: string; name: string }[]; reviewers: { id: string; name: string }[]; branches: { id: string; name: string }[] }

/** A19 Nov 6: Win-Back — picked customers saved as an unsent audience draft */
export interface WinbackPickedResult { draftId: string; status: string; channel: string; selected: number; eligible: number; excluded: number; sends: number; duplicate: boolean }

/** F5 §73 (Nov 6 2026): the technician's Today / Week / Month metrics */
export interface TechMetricsResponse { period: 'today' | 'week' | 'month'; from: string; to: string; timezone: string;
  clockedMinutes: number | null; breakMinutes: number | null; serviceMinutes: number | null; readyMinutes: number | null; turnUnits: number | null; services: number | null }

/** AI Receptionist Settings backlog · 06 (Nov 12 2026): POST /pos/ai/receptionist-center/control/restore — the protected
 *  settings moved back to a past version through the ordinary gated control actions (each version-checked, audited,
 *  append-only). `actions` = the steps taken, in order (empty when the settings already match); `control` = the settings now. */
export interface RcControlRestoreResult {
  restoredFrom: string; actions: string[]; blockers: string[]; control: unknown; replayed: boolean;
}
