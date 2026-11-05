// ai.ts — wire contract (Constitution 13 §13, §15). Realm: platform. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface FleetSummary {
  connected: boolean;                       // false when no DB is available (honest)
  tenantsWithAgents: number;
  agentsByStatus: Record<string, number>;
  provisioningFailures: number;
  openFollowUps: number;
}

export interface Suggestion { id: string; tenantId: string; sourceCallId: string | null; category: string; targetType: string; detail: string; status: 'open' | 'approved' | 'rejected' | 'applied'; reviewedBy: string | null; resultingVersionId: string | null; createdMs: number; }

// Voice receptionist prompt versions (per tenant). A different concept from the AI platform's prompt-registry
// PromptVersion, so the contract names them apart (Constitution 13 §15).
export type VoicePromptStatus = 'draft' | 'pending_review' | 'active' | 'archived';
export interface VoicePromptVersion { id: string; tenantId: string; scope: string; versionLabel: string; body: string; status: VoicePromptStatus; parentVersionId: string | null; createdBy: string | null; approvedBy: string | null; activatedMs: number | null; createdMs: number; }

export interface NormalizedCallOutcome {
  providerCallId: string;
  promptVersion: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  language: string | null;
  intents: string[];
  toolCalls: { name: string; ok: boolean }[];
  bookingOutcome: string | null;
  handoffOutcome: string | null;
  sentiment: string | null;
  errorCategory: string | null;
  interruptionCount: number;
  repeatedQuestionCount: number;
  abandoned: boolean;
  followUpRequired: boolean;
  summary: string | null;
}
export interface CallOutcomeRecord extends NormalizedCallOutcome { id: string; tenantId: string; branchId: string; provider: string; createdMs: number; }
