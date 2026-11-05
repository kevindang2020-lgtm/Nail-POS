// security-events-wiring.vitest.spec — the API's wiring of the security-event recorder: each emitter records at its
// point of rejection or change, and the global module is registered. Asserted from the API (the recorder itself moved
// to a module; a module's tests must not read the API's files — Constitution 13 §105).
import { sourcePath } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';


describe('wiring — each emitter records at its point of rejection or change', () => {
  const src = (p: string) => readFileSync(sourcePath(p), 'utf8');   // API or owning module (Constitution 13)
  it.each([
    ['../../modules/payments/src/payments/payment-webhook.controller.ts', /out\.status === 401\) void this\.securityEvents\?\.record\(\{ type: 'WEBHOOK_SIGNATURE_FAILED'/],
    ['src/deposit-reconciliation/deposit-reconciliation.webhook.controller.ts', /result\.status === 401\) void this\.securityEvents\?\.record\(\{ type: 'WEBHOOK_SIGNATURE_FAILED'/],
    ['src/messaging-inbound/twilio-inbound.controller.ts', /reason === 'bad_signature'\) void this\.securityEvents\?\.record\(\{ type: 'WEBHOOK_SIGNATURE_FAILED'.*twilio_inbound/],
    ['src/messaging-inbound/twilio-inbound.controller.ts', /reason === 'bad_signature'\) void this\.securityEvents\?\.record\(\{ type: 'WEBHOOK_SIGNATURE_FAILED'.*twilio_status/],
    ['src/customer-booking/booking-verification-webhook.controller.ts', /type: 'WEBHOOK_SIGNATURE_FAILED'.*twilio_booking_verification/],
    ['src/super-admin-platform/super-admin-platform.controller.ts', /type: 'SUPPORT_MODE_STARTED'/],
    ['src/super-admin-platform/super-admin-platform.controller.ts', /type: 'SUPPORT_MODE_ENDED'/],
    ['../../modules/identity/src/auth/mfa.controller.ts', /type: 'MFA_CONFIRMED'/],   // identity is modules/identity
    ['src/observability/cross-tenant-signal.ts', /type: 'CROSS_TENANT_ACCESS_ATTEMPT'/],
  ])('%s', (file, re) => expect(src(file)).toMatch(re));
  it('the global module is registered in AppModule — otherwise every @Optional() emitter is silently off', () => {
    expect(src('src/app.module.ts')).toMatch(/imports:\s*\[\s*\n\s*SecurityEventsModule,/);
  });
});
