// api-error.ts — Constitution 5 §30: new code throws a REGISTERED error (the code is typed, so an unregistered one does
// not compile); the exception filter turns it into the standard envelope.
import { HttpException } from '@nestjs/common';
import { ERROR_REGISTRY, type ApiErrorCode } from '@aipowersalon/api-contracts';
export function apiError(code: ApiErrorCode, opts: { message?: string; details?: Record<string, unknown> } = {}): HttpException {
  const def = ERROR_REGISTRY[code];
  return new HttpException({ code, message: opts.message ?? def.message, ...(opts.details ? { details: opts.details } : {}) }, def.status);
}
