// ai-scheduling-errors.ts — error taxonomy → HTTP. Services throw semantic codes; the controller maps SchedError.status.
export type SchedErrorCode =
  | 'NOT_FOUND' | 'FORBIDDEN' | 'TENANT_REQUIRED' | 'MODULE_DISABLED'
  | 'NO_FEASIBLE_OPTION' | 'HARD_CONSTRAINT_VIOLATION' | 'INVALID_STATE' | 'RECOMMENDATION_EXPIRED'
  | 'CUSTOMER_APPROVAL_REQUIRED' | 'STALE_SCHEDULE' | 'APPLICATION_FAILED' | 'AUTOMATION_NOT_PERMITTED'
  | 'LOCKED_APPOINTMENT' | 'AI_USAGE_LIMIT_REACHED'   // Functional Decision 30's code
  | 'VERSION_CONFLICT'      // optimistic lock: the row changed since the client read it (registry code, api-contracts errors.ts)
  | 'VALIDATION_FAILED' | 'SLOT_HELD';

const STATUS: Record<SchedErrorCode, number> = {
  NOT_FOUND: 404, FORBIDDEN: 403, TENANT_REQUIRED: 400, MODULE_DISABLED: 403,
  NO_FEASIBLE_OPTION: 422, HARD_CONSTRAINT_VIOLATION: 422, INVALID_STATE: 409, RECOMMENDATION_EXPIRED: 410,
  CUSTOMER_APPROVAL_REQUIRED: 409, STALE_SCHEDULE: 409, APPLICATION_FAILED: 502, AUTOMATION_NOT_PERMITTED: 403,
  LOCKED_APPOINTMENT: 409, AI_USAGE_LIMIT_REACHED: 429,
  VERSION_CONFLICT: 409, VALIDATION_FAILED: 400, SLOT_HELD: 409,
};

export class SchedError extends Error {
  readonly status: number; readonly extra?: Record<string, unknown>;
  constructor(public readonly code: SchedErrorCode, message?: string, extra?: Record<string, unknown>) {
    super(message || code); this.name = 'SchedError'; this.status = STATUS[code]; this.extra = extra;
  }
}
