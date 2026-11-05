// BUILD_PLAN Phase 12 round 2 (#17): the Face ID (WebAuthn) ceremonies and customer self-registration, route by route on
// the real controllers — the mobile-sdk / customer-web bodies pass intact, unknown fields are stripped, a bad body is a
// 400 VALIDATION_FAILED naming the field, an undeclared tenantId / platformRole is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { WebAuthnController as W } from './auth/webauthn.controller';
import { CustomerRegistrationController as CR } from './customer-registration/customer-registration.controller';

const b64 = 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0';
const CASES: RouteBodyCase[] = [
  { route: 'POST /auth/webauthn/register/finish', ctl: W, handler: 'finishRegister', today: [{ handle: 'h-1', credentialId: 'cred-1', clientDataJSON: b64, attestationObject: b64, deviceLabel: 'iPhone' }], bad: [{ handle: 'h', clientDataJSON: { x: 1 } }, 'clientDataJSON'] },
  { route: 'POST /auth/webauthn/authenticate/begin', ctl: W, handler: 'beginAuth', today: [{ emailOrPhone: 'mai@example.com' }, {}], bad: [{ emailOrPhone: ['x'] }, 'emailOrPhone'] },
  { route: 'POST /auth/webauthn/authenticate/finish', ctl: W, handler: 'finishAuth', today: [{ handle: 'h-1', credentialId: 'cred-1', clientDataJSON: b64, authenticatorData: b64, signature: b64 }], bad: [{ handle: 'h', signature: 'x'.repeat(16385) }, 'signature'] },
  { route: 'POST /customer/auth/register', ctl: CR, handler: 'register', today: [{ salonCode: 'GLOW', firstName: 'Mai', lastName: 'Tran', email: 'mai@example.com', phone: '6095551234', password: 'correct horse battery' }, { salonId: '22222222-2222-4222-8222-222222222222', firstName: 'Mai', lastName: 'Tran', email: 'm@x.co', phone: '6095551234', password: 'pw-123456' }], bad: [{ firstName: { f: 1 } }, 'firstName'] },
];
describe('identity (round 2) — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
