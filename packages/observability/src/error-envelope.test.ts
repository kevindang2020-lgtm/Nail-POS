// error-envelope.test.ts — Constitution 5 §28–31: the standard error envelope, as a superset of today's bodies.
import { describe, it, expect } from 'vitest';
import { HttpException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { toErrorEnvelope, leaksInternals } from './error-envelope';
import { PlatformExceptionFilter } from './request-telemetry';
import { apiError } from './nest/api-error';

describe('toErrorEnvelope', () => {
  it('a legacy body keeps every field it had and gains error{code,message,details,action}', () => {
    const out: any = toErrorEnvelope({ status: 403, body: { ok: false, code: 'pin_login_disabled', message: 'Your salon requires your password.' }, requestId: 'req_1', unexpected: false });
    expect(out).toMatchObject({ ok: false, code: 'pin_login_disabled', message: 'Your salon requires your password.', statusCode: 403, requestId: 'req_1', reference: 'req_1' });
    expect(out.error).toEqual({ code: 'pin_login_disabled', message: 'Your salon requires your password.', details: {}, action: 'RETRY' });
  });
  it('no code → the registry code for the status; Nest’s status-text `error` string gives way to the object', () => {
    const out: any = toErrorEnvelope({ status: 401, body: { message: 'No session', error: 'Unauthorized', statusCode: 401 }, unexpected: false });
    expect(out.error).toMatchObject({ code: 'AUTH_REQUIRED', message: 'No session', action: 'REAUTHENTICATE' });
    expect(out.code).toBe('AUTH_REQUIRED');
  });
  it('ValidationPipe → VALIDATION_FAILED with the messages as details; the top-level message array stays for old clients', () => {
    const out: any = toErrorEnvelope({ status: 400, body: { message: ['phone must be a valid phone number'], error: 'Bad Request' }, unexpected: false });
    expect(out.error).toEqual({ code: 'VALIDATION_FAILED', message: 'Some fields are invalid.', details: { messages: ['phone must be a valid phone number'] }, action: 'NONE' });
    expect(out.message).toEqual(['phone must be a valid phone number']);
  });
  it('§31: SQL, stack frames, table names, internal hosts and secrets never reach the client — message AND details', () => {
    for (const leak of ['duplicate key value violates unique constraint "users_email_key"', 'relation "tenant_api_keys" does not exist', 'select * from users where id = $1',
      'Error at Object.run (/app/dist/x.js:12:5)', 'connect ECONNREFUSED postgres.railway.internal:5432', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'key SG.abcdefghijklmno']) {
      expect(leaksInternals(leak)).toBe(true);
      const out: any = toErrorEnvelope({ status: 409, body: { message: leak, details: { stack: 'x', sql: 'y', note: leak, ok: 'fine' } }, unexpected: false });
      expect(JSON.stringify(out)).not.toContain(leak);
      expect(out.error.details).toEqual({ ok: 'fine' });
    }
    expect(leaksInternals('This technician is no longer available.')).toBe(false);
  });
  it('an unexpected (non-HTTP) error is INTERNAL_ERROR with the safe message, whatever it said', () => {
    const out: any = toErrorEnvelope({ status: 500, body: { message: 'TypeError: cannot read x of undefined', code: 'DB_EXPLODED' }, unexpected: true });
    expect(out.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', action: 'RETRY' });
  });
});

describe('protocol bodies keep their protocol', () => {
  it('an OAuth token-endpoint error stays RFC 6749: error is the STRING code, error_description beside it', () => {
    const out: any = toErrorEnvelope({ status: 400, body: { error: 'unsupported_grant_type', error_description: 'authorization_code or refresh_token' }, requestId: 'req_2', unexpected: false });
    expect(out).toEqual({ error: 'unsupported_grant_type', error_description: 'authorization_code or refresh_token', requestId: 'req_2' });
    // a Nest status text (`error: "Bad Request"`) is NOT a protocol body — it still gets the envelope
    expect((toErrorEnvelope({ status: 400, body: { message: 'x', error: 'Bad Request' }, unexpected: false }) as any).error.code).toBe('BAD_REQUEST');
  });
});

describe('the filter end to end', () => {
  const run = (exc: unknown) => {
    let status = 0, body: any; const res: any = { setHeader() {}, status(s: number) { status = s; return this; }, json(b: any) { body = b; } };
    const host: any = { switchToHttp: () => ({ getRequest: () => ({ method: 'GET', route: { path: '/x' }, telemetry: { requestId: 'req_9' } }), getResponse: () => res }) };
    new PlatformExceptionFilter().catch(exc, host); return { status, body };
  };
  it('apiError(code) → its registered status, code, safe message and action', () => {
    const { status, body } = run(apiError('VERSION_CONFLICT', { details: { currentVersion: 7 } }));
    expect(status).toBe(409);
    expect(body.error).toEqual({ code: 'VERSION_CONFLICT', message: 'Someone else changed this. Refresh and try again.', details: { currentVersion: 7 }, action: 'REFRESH' });
    expect(body.requestId).toBe('req_9');
  });
  it('a bare Nest exception and a crash are both enveloped', () => {
    expect(run(new UnauthorizedException('No session')).body.error.code).toBe('AUTH_REQUIRED');
    expect(run(new BadRequestException(['a must be a string'])).body.error.code).toBe('VALIDATION_FAILED');
    const crash = run(new Error('relation "x" does not exist'));
    expect(crash.status).toBe(500); expect(JSON.stringify(crash.body)).not.toContain('relation');
    expect(run(new HttpException({ ok: false, code: 'ALREADY_USED', message: 'Used.' }, 400)).body).toMatchObject({ ok: false, code: 'ALREADY_USED', error: { code: 'ALREADY_USED' } });
  });
});
