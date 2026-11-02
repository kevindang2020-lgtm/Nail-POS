// coded-refusal.test.ts — Vietnamese POS §58 V-5 (Oct 27 2026): a refusal thrown with withCode(…) answers its registry code
// (+ params in details) beside the unchanged English — both when the exception itself is coded and when a controller
// re-threw only the sentence (`new HttpException(e.message, 400)`, the commonest mapping in the modules). The status is
// never changed, and a specific code a controller chose is never replaced.
import { describe, it, expect } from 'vitest';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { PlatformExceptionFilter, withRequestCode } from './request-telemetry';
import { runWithContext, type TelemetryContext } from './request-context';

class ValidationError extends Error {}
const ctx = (): TelemetryContext => ({ requestId: 'req_v5', correlationId: 'req_v5', traceId: '0'.repeat(32), service: 'api' });
function answer(c: TelemetryContext, exc: unknown) {
  let status = 0, body: any; const res: any = { setHeader() {}, status(s: number) { status = s; return this; }, json(b: any) { body = b; } };
  const host: any = { switchToHttp: () => ({ getRequest: () => ({ method: 'POST', route: { path: '/x' }, telemetry: c }), getResponse: () => res }) };
  runWithContext(c, () => new PlatformExceptionFilter().catch(exc, host));
  return { status, body };
}

describe('V-5: the refusal answers its registry code', () => {
  it('a coded HttpException: code + params, English and status unchanged', () => {
    const c = ctx();
    const { status, body } = answer(c, withCode(new BadRequestException('This ticket is already paid.'), 'TICKET_ALREADY_PAID'));
    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code: 'TICKET_ALREADY_PAID', message: 'This ticket is already paid.' });
    expect(body.code).toBe('TICKET_ALREADY_PAID');
  });
  it('a controller that re-threw only the sentence still answers the code the service attached (same request)', () => {
    const c = ctx();
    let thrown: any;
    runWithContext(c, () => { try { throw withCode(new ValidationError('Not enough stock on hand (3)'), 'INSUFFICIENT_STOCK', { onHand: 3 }); } catch (e) { thrown = e; } });
    const { status, body } = answer(c, new HttpException(thrown.message, 400));
    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Not enough stock on hand (3)', details: { onHand: 3, messageCode: 'INSUFFICIENT_STOCK' } });
  });
  it('another request\'s coded error never leaks into this answer', () => {
    const a = ctx(); const b = { ...ctx(), requestId: 'req_other' };
    runWithContext(a, () => { withCode(new ValidationError('Booking not found'), 'TICKET_ALREADY_PAID'); });
    expect(answer(b, new NotFoundException('Booking not found')).body.error.code).toBe('RESOURCE_NOT_FOUND');
  });
  it('a code the controller chose stays (the registry code rides in details.messageCode); a different sentence is not matched', () => {
    const c = ctx();
    runWithContext(c, () => { withCode(new ValidationError('A'), 'TICKET_ALREADY_PAID'); });
    // a legacy kind a screen branches on stays the code; the registry code rides beside it for the wording
    expect(withRequestCode({ message: 'A', code: 'legacy_kind' }, null, c, 400)).toEqual({ message: 'A', code: 'legacy_kind', details: { messageCode: 'TICKET_ALREADY_PAID' } });
    expect(withRequestCode({ message: 'B' }, null, c, 400)).toEqual({ message: 'B' });
    expect(withRequestCode({ message: 'A', code: 'BAD_REQUEST' }, null, c, 400)).toMatchObject({ code: 'TICKET_ALREADY_PAID' });
  });
});
