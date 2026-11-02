// ai-ocr-receipt-errors.ts — error taxonomy → HTTP. Controllers map OcrError.status; services throw semantic codes.
export type OcrErrorCode =
  | 'NOT_FOUND' | 'FORBIDDEN' | 'TENANT_REQUIRED' | 'MODULE_DISABLED'
  | 'INVALID_UPLOAD' | 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE' | 'MALWARE_QUARANTINE'
  | 'INVALID_STATE' | 'NOT_APPROVED' | 'DUPLICATE_BLOCKED' | 'POSTING_FAILED'
  | 'VALIDATION_BLOCKED' | 'AI_USAGE_LIMIT_REACHED';   // Functional Decision 30's code (was USAGE_LIMIT_REACHED; no client read it)

const STATUS: Record<OcrErrorCode, number> = {
  NOT_FOUND: 404, FORBIDDEN: 403, TENANT_REQUIRED: 400, MODULE_DISABLED: 403,
  INVALID_UPLOAD: 400, UNSUPPORTED_TYPE: 415, FILE_TOO_LARGE: 413, MALWARE_QUARANTINE: 422,
  INVALID_STATE: 409, NOT_APPROVED: 409, DUPLICATE_BLOCKED: 409, POSTING_FAILED: 502,
  VALIDATION_BLOCKED: 422, AI_USAGE_LIMIT_REACHED: 429,
};

export class OcrError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;
  constructor(public readonly code: OcrErrorCode, message?: string, extra?: Record<string, unknown>) {
    super(message || code);
    this.name = 'OcrError';
    this.status = STATUS[code];
    this.extra = extra;
  }
}
