// customer-phone-http.ts — ONE mapping from PhoneUpdateError to HTTP for both controllers (POS + customer app). There
// were two copies and they had drifted: the customer app sent `disabled` as 400 where POS sent 403.
// Constitution 5 §57: a stale record is VERSION_CONFLICT on the wire (as booking, queue, customers and memberships);
// `details` (e.extra) still carries what the caller needs to ACT — the current version, the masked duplicates.
import { HttpException, HttpStatus } from '@nestjs/common';
import { PhoneUpdateError } from './customer-phone-update.service';
export function phoneUpdateHttpError(e: PhoneUpdateError): HttpException {
  const status =
    e.code === 'forbidden' || e.code === 'disabled' ? HttpStatus.FORBIDDEN
    : e.code === 'reauth_required' ? HttpStatus.UNAUTHORIZED
    : e.code === 'rate_limited' ? HttpStatus.TOO_MANY_REQUESTS
    : e.code === 'stale_record' ? HttpStatus.CONFLICT           // somebody else changed it; review and retry
    : e.code === 'duplicate_conflict' ? HttpStatus.CONFLICT     // a human must resolve this, not a retry
    : e.code === 'no_provider' ? HttpStatus.SERVICE_UNAVAILABLE
    : e.code === 'not_found' ? HttpStatus.NOT_FOUND
    : HttpStatus.BAD_REQUEST;
  return new HttpException({ code: e.code === 'stale_record' ? 'VERSION_CONFLICT' : e.code, message: e.message, ...(e.extra ?? {}) }, status);
}
