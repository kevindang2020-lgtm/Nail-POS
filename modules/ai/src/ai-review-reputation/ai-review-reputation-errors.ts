// ai-review-reputation-errors.ts — the module's stable error taxonomy and its mapping to HTTP status codes. Controllers
// use mapErrorToHttp so the surface is consistent and never leaks internals (unknown → 500).
export const REPUTATION_ERROR_STATUS: Record<string, number> = {
  // auth / access
  NOT_AUTHENTICATED: 403,
  FORBIDDEN: 403,
  BRANCH_NOT_AUTHORIZED: 403,
  TENANT_REQUIRED: 403,
  // not found
  REVIEW_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  ESCALATION_NOT_FOUND: 404,
  // workflow conflicts
  INVALID_RESPONSE_TRANSITION: 409,
  INVALID_ESCALATION_TRANSITION: 409,
  NOT_APPROVED: 409,
  ASSISTANT_DISABLED: 409,          // the salon or branch switched the assistant off — no AI drafts (Nov 2 2026)
  ALREADY_REQUESTED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  // validation / safety
  DRAFT_UNSAFE: 422,
  AUTO_RESPONSE_NOT_ELIGIBLE: 422,
  VALIDATION_ERROR: 400,
  // downstream
  PUBLISH_FAILED: 502,
  INTEGRATION_DISCONNECTED: 502,
  DISPATCH_FAILED: 502,
  // fallback
  INTERNAL_ERROR: 500,
};

export function mapErrorToHttp(code: string): number {
  return REPUTATION_ERROR_STATUS[code] ?? 500;
}

/** Normalize a thrown error's message to a stable code (falls back to INTERNAL_ERROR). */
export function errorCode(e: unknown): string {
  const msg = (e as any)?.message ?? '';
  return msg in REPUTATION_ERROR_STATUS ? msg : 'INTERNAL_ERROR';
}
