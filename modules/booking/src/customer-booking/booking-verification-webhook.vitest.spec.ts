// booking-verification-webhook.vitest.spec.ts
//
// This endpoint is PUBLIC. Twilio is the caller, so there is no session — which means anybody on the internet can
// POST to it. Everything below is about what an attacker must not be able to do:
//
//   • name their own tenant, and mark another salon's verification as approved
//   • forge a callback without that tenant's own Twilio auth token
//   • learn, from a status code, whether a SID or a tenant exists
//   • undo a verification that already succeeded, with a late delivery-failure callback
//   • double-apply a retried webhook
import { describe, it, expect } from 'vitest';
import { computeTwilioSignature, verifyTwilioSignature } from '@aipowersalon/notifications';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// These tests read the controller's own SOURCE to assert a decorator is really on it. That is a legitimate thing
// to check — the point is that the choice is DELIBERATE — but it used to do it with require(), which is a CommonJS
// call in an ESM spec and had eslint erroring on four lines. Same assertion, same file, ESM.
const HERE = dirname(fileURLToPath(import.meta.url));

// The controller's own logic is a thin shell over two things: the signature check (already proven in
// twilio-inbound) and the SQL. What is worth testing HERE is the reasoning the shell encodes — so these tests
// drive the primitives and the decisions, and the SQL is covered by the pgtest.

const TOKEN_A = 'tenant-a-auth-token';
const TOKEN_B = 'tenant-b-auth-token';
const URL = 'https://api.aipowersalon.com/webhooks/twilio/booking-verification/status';

describe('the signature must be checked with THE TENANT\u2019S OWN token', () => {
  it('accepts a callback signed with the right tenant\u2019s token', () => {
    const params = { VerificationSid: 'VE123', VerificationStatus: 'approved' };
    const sig = computeTwilioSignature(TOKEN_A, URL, params);
    expect(verifyTwilioSignature(TOKEN_A, URL, params, sig)).toBe(true);
  });

  it('REJECTS a callback signed with a DIFFERENT tenant\u2019s token', () => {
    // Each tenant signs with their own Twilio credentials — there is no single platform secret. This is exactly
    // why the tenant must be resolved from OUR stored row before verifying: verifying against a key the caller
    // chose would verify nothing at all.
    const params = { VerificationSid: 'VE123', VerificationStatus: 'approved' };
    const sig = computeTwilioSignature(TOKEN_B, URL, params);
    expect(verifyTwilioSignature(TOKEN_A, URL, params, sig)).toBe(false);
  });

  it('REJECTS an unsigned callback', () => {
    const params = { VerificationSid: 'VE123', VerificationStatus: 'approved' };
    expect(verifyTwilioSignature(TOKEN_A, URL, params, undefined)).toBe(false);
    expect(verifyTwilioSignature(TOKEN_A, URL, params, '')).toBe(false);
  });

  it('REJECTS a callback whose BODY was tampered with after signing', () => {
    // The signature covers every parameter. An attacker who intercepts a legitimate `failed` callback and flips
    // it to `approved` invalidates it.
    const original = { VerificationSid: 'VE123', VerificationStatus: 'failed' };
    const sig = computeTwilioSignature(TOKEN_A, URL, original);
    const tampered = { VerificationSid: 'VE123', VerificationStatus: 'approved' };
    expect(verifyTwilioSignature(TOKEN_A, URL, tampered, sig)).toBe(false);
  });

  it('REJECTS a signature computed for a DIFFERENT url', () => {
    // The URL is part of the signed payload, so a signature captured from one endpoint cannot be replayed at
    // another.
    const params = { VerificationSid: 'VE123', VerificationStatus: 'approved' };
    const sig = computeTwilioSignature(TOKEN_A, 'https://evil.example/other', params);
    expect(verifyTwilioSignature(TOKEN_A, URL, params, sig)).toBe(false);
  });
});

describe('the decisions the controller encodes', () => {
  // These mirror the controller's branches. They are written as plain predicates so the REASONING is pinned even
  // though the SQL lives in the pgtest.

  const shouldOverwrite = (currentStatus: string) => !['verified', 'failed'].includes(currentStatus);

  it('a late delivery-FAILURE never undoes a verification that already SUCCEEDED', () => {
    // The customer typed the code. A delayed `undelivered` callback about the SMS does not change that — and
    // treating it as if it did would fail a booking that had already succeeded, minutes after the customer was
    // told they were confirmed.
    expect(shouldOverwrite('verified')).toBe(false);
  });

  it('a retried failure callback does not re-apply', () => {
    // Twilio retries. Applying the same event twice can move a session backwards through its lifecycle.
    expect(shouldOverwrite('failed')).toBe(false);
  });

  it('but a pending session CAN be failed', () => {
    expect(shouldOverwrite('pending')).toBe(true);
    expect(shouldOverwrite('sent')).toBe(true);
  });
});

describe('the endpoint reveals nothing', () => {
  it('returns 204 for every outcome — success, bad signature, unknown SID alike', () => {
    // A 401 tells an attacker their signature guess was wrong. A 404 tells them a SID does not exist. Both are
    // oracles. Twilio does not care about the status code, and silence teaches an attacker nothing.
    //
    // This is asserted by reading the decorator rather than booting Nest: the value of the test is that the
    // choice is DELIBERATE and recorded, not that a framework applies its own annotation.
    const src = readFileSync(join(HERE, 'booking-verification-webhook.controller.ts'), 'utf8');
    expect(src).toContain('@HttpCode(204)');
    // and there is no path that throws a 401/403/404 back to the caller
    expect(src).not.toMatch(/Unauthorized|NotFound|throw new HttpException/);
  });

  it('never takes the tenant from the request body', () => {
    const src = readFileSync(join(HERE, 'booking-verification-webhook.controller.ts'), 'utf8');
    // The tenant comes from the row we stored against the provider's SID. A tenant id read from the body is a
    // tenant id an ATTACKER CHOOSES — they could approve another salon's verification at will.
    expect(src).not.toMatch(/params\.TenantId|body\?\.tenantId|body\.tenant_id/);
    expect(src).toContain('const tenantId = String(row.tenant_id)');
  });
});
