// customer-phone-http.vitest.spec — the one PhoneUpdateError → HTTP mapping (POS + customer app).
import { describe, it, expect } from 'vitest';
import { PhoneUpdateError } from './customer-phone-update.service';
import { phoneUpdateHttpError } from './customer-phone-http';
const map = (code: any, extra?: any) => { const h = phoneUpdateHttpError(new PhoneUpdateError('m', code, extra)); return { status: h.getStatus(), body: h.getResponse() as any }; };
describe('PhoneUpdateError → HTTP', () => {
  it('a stale record is 409 VERSION_CONFLICT, keeping the details needed to act', () => {
    const r = map('stale_record', { currentVersion: 7 });
    expect(r.status).toBe(409); expect(r.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 7 });
  });
  it('the other codes keep their meaning; disabled is 403 for BOTH callers now', () => {
    expect(map('duplicate_conflict').status).toBe(409); expect(map('duplicate_conflict').body.code).toBe('duplicate_conflict');
    expect(map('disabled').status).toBe(403); expect(map('forbidden').status).toBe(403);
    expect(map('no_provider').status).toBe(503); expect(map('not_found').status).toBe(404); expect(map('invalid_phone').status).toBe(400);
  });
});
