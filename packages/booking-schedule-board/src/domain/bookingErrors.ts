/**
 * Domain-level errors (spec §21, §22, §35). The adapter layer must translate
 * raw transport / database failures into one of these before they reach the UI.
 */
export type BookingErrorCode =
  | 'APPOINTMENT_CONFLICT'
  | 'TECHNICIAN_UNAVAILABLE'
  | 'TECHNICIAN_SERVICE_INELIGIBLE'
  | 'SCHEDULE_CHANGED'
  | 'PERMISSION_DENIED'
  | 'INVALID_DURATION'
  | 'BLOCKED_TIME_CONFLICT'
  | 'APPOINTMENT_PROTECTION'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export const BOOKING_ERROR_MESSAGES: Record<BookingErrorCode, string> = {
  APPOINTMENT_CONFLICT: 'That time was just booked. The schedule has been updated.',
  TECHNICIAN_UNAVAILABLE: 'This technician is not available at that time.',
  TECHNICIAN_SERVICE_INELIGIBLE: 'This technician is not qualified for the selected service.',
  SCHEDULE_CHANGED: 'The schedule changed while you were working. It has been refreshed.',
  PERMISSION_DENIED: 'You do not have permission to make this change.',
  INVALID_DURATION: 'The service duration does not fit in the selected opening.',
  BLOCKED_TIME_CONFLICT: 'That time is blocked and cannot be booked.',
  APPOINTMENT_PROTECTION: 'This service would run into a protected appointment.',
  NOT_FOUND: 'That appointment no longer exists.',
  VALIDATION_FAILED: 'Some of the booking details are invalid.',
  NETWORK_ERROR: 'The schedule service could not be reached. Please try again.',
  UNKNOWN: 'Something went wrong. The schedule has been refreshed.',
};

export class BookingDomainError extends Error {
  readonly code: BookingErrorCode;
  readonly details?: Record<string, unknown>;
  /** Set when the backend returns a fresher schedule version alongside the error. */
  readonly serverVersion?: number;

  constructor(
    code: BookingErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    serverVersion?: number,
  ) {
    super(message ?? BOOKING_ERROR_MESSAGES[code]);
    this.name = 'BookingDomainError';
    this.code = code;
    this.details = details;
    this.serverVersion = serverVersion;
  }

  static is(e: unknown): e is BookingDomainError {
    return e instanceof BookingDomainError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'BookingDomainError');
  }
}

/** Normalise any thrown value into a BookingDomainError for the UI. */
export function toBookingError(e: unknown): BookingDomainError {
  if (BookingDomainError.is(e)) return e as BookingDomainError;
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    const code = (e as { code: string }).code as BookingErrorCode;
    if (code in BOOKING_ERROR_MESSAGES) {
      return new BookingDomainError(code, (e as { message?: string }).message);
    }
  }
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return new BookingDomainError('NETWORK_ERROR');
  }
  return new BookingDomainError('UNKNOWN');
}
