// serving-http-error.vitest.spec.ts — Nov 6 2026 full run: the Tech App's change / remove line requests run through the
// serving engine, and the tech controller answered every serving refusal as a 500 ("Service line not found" was a 500).
// servingHttpError() is now the one mapping both controllers use.
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { servingHttpError } from './serving.controller';
import { ValidationError, ForbiddenError, ConflictError } from './serving.service';

const status = (e: unknown) => (servingHttpError(e) as HttpException).getStatus();
const body = (e: unknown) => (servingHttpError(e) as HttpException).getResponse() as any;

describe('servingHttpError', () => {
  it('a missing service line is a 404 with its code, not a 500', () => {
    const e = withCode(new ValidationError('Service line not found'), 'SERVICE_LINE_NOT_FOUND');
    expect(status(e)).toBe(404);
    expect(body(e)).toMatchObject({ code: 'SERVICE_LINE_NOT_FOUND' });
  });
  it('an uncoded refusal is a 400; forbidden 403; conflict 409', () => {
    expect(status(new ValidationError('Service is inactive.'))).toBe(400);
    expect(status(new ForbiddenError('no'))).toBe(403);
    expect(status(new ConflictError('changed'))).toBe(409);
  });
  it('anything else is not a serving refusal (the caller answers it)', () => {
    expect(servingHttpError(new Error('db down'))).toBeNull();
    expect(servingHttpError({ message: 'x' })).toBeNull();
  });
});
