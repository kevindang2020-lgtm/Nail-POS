// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface WorkflowStat { key: WorkflowKey; sentToday: number; successRatePct: number | null }

/**
 * workflow-runs.dto.ts — per-workflow run-history contract + pure summary. Idempotent on dedupeKey. A run is one
 * automation send (sent/failed/skipped/queued). summarize() yields per-workflow sent-today + 7d success rate.
 */
export type WorkflowKey = 'appointment_reminder' | 'birthday_campaign' | 'review_request' | 'rebooking_flow' | 'thank_you' | 'ai_follow_up';
