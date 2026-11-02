// expense-errors.ts — the standard error codes (mandate §143) and the words an owner reads (§144).
export const EXPENSE_ERROR_STATUS = {
  RECEIPT_NOT_FOUND: 404,
  RECEIPT_PROCESSING_FAILED: 422,
  RECEIPT_UNSUPPORTED_FORMAT: 415,
  RECEIPT_TOO_LARGE: 413,
  RECEIPT_DUPLICATE: 409,
  RECEIPT_POSSIBLE_DUPLICATE: 409,
  EXPENSE_NOT_FOUND: 404,
  EXPENSE_VERSION_CONFLICT: 409,
  EXPENSE_ALREADY_APPROVED: 409,
  EXPENSE_INVALID_STATE: 409,
  EXPENSE_ACCESS_DENIED: 403,
  EXPENSE_CATEGORY_NOT_FOUND: 400,
  EXPENSE_INVALID: 400,
  VENDOR_NOT_FOUND: 404,
  OCR_PROVIDER_UNAVAILABLE: 503,
  OCR_LOW_CONFIDENCE: 422,
  EXPENSE_ALLOCATION_INVALID: 400,
  BILL_INVALID: 400,
} as const;
export type ExpenseErrorCode = keyof typeof EXPENSE_ERROR_STATUS;

export const EXPENSE_ERROR_MESSAGE: Record<ExpenseErrorCode, string> = {
  RECEIPT_NOT_FOUND: 'That receipt was not found.',
  RECEIPT_PROCESSING_FAILED: 'We could not read this receipt. You can retry, or enter it by hand.',
  RECEIPT_UNSUPPORTED_FORMAT: 'Use a JPEG, PNG, HEIC or PDF file.',
  RECEIPT_TOO_LARGE: 'That file is too large.',
  RECEIPT_DUPLICATE: 'This receipt was already saved.',
  RECEIPT_POSSIBLE_DUPLICATE: 'This looks similar to an expense already saved.',
  EXPENSE_NOT_FOUND: 'That expense was not found.',
  EXPENSE_VERSION_CONFLICT: 'Someone else changed this expense a moment ago. The latest version is shown — check it and try again.',
  EXPENSE_ALREADY_APPROVED: 'This expense is already approved.',
  EXPENSE_INVALID_STATE: 'That cannot be done to this expense in its current state.',
  EXPENSE_ACCESS_DENIED: 'You do not have access to this expense.',
  EXPENSE_CATEGORY_NOT_FOUND: 'Choose one of your expense categories.',
  EXPENSE_INVALID: 'Some details are missing or not valid.',
  VENDOR_NOT_FOUND: 'That vendor was not found.',
  OCR_PROVIDER_UNAVAILABLE: 'Receipt reading is not available right now. The receipt is saved — enter the details by hand or try again later.',
  OCR_LOW_CONFIDENCE: 'We could not confidently read some information from this receipt. Please review the highlighted fields.',
  EXPENSE_ALLOCATION_INVALID: 'The branch split must add up to the full amount.',
  BILL_INVALID: 'That bill payment is not valid.',
};

export class ExpenseError extends Error {
  readonly status: number;
  constructor(readonly code: ExpenseErrorCode, detail?: string, readonly extra: Record<string, unknown> = {}) {
    super(detail || EXPENSE_ERROR_MESSAGE[code]);
    this.status = EXPENSE_ERROR_STATUS[code];
  }
}
