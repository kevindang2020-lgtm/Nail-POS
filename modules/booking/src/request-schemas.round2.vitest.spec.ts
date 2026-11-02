// BUILD_PLAN Phase 12 round 2 (#17): booking's verification-override / oversight / settings routes, the Twilio status
// callback and the customer-phone routes — route by route on the real controllers: today's bodies (pos-web, admin-web,
// customer-web) pass intact, unknown fields are stripped (the Twilio callback keeps every scalar provider field), a bad
// body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { BookingVerificationOverrideController as VO } from './customer-booking/booking-verification-override.controller';
import { BookingVerificationOversightController as VS } from './customer-booking/booking-verification-oversight.controller';
import { BookingVerificationSettingsController as VT } from './customer-booking/booking-verification-settings.controller';
import { BookingVerificationWebhookController as VW } from './customer-booking/booking-verification-webhook.controller';
import { CustomerPhoneAppController as PA } from './customer-phone/customer-phone-app.controller';
import { CustomerPhoneSettingsController as PS, CustomerPhoneOversightController as PO } from './customer-phone/customer-phone-settings.controller';
import { CustomerPhoneController as P } from './customer-phone/customer-phone.controller';

const I = '22222222-2222-4222-8222-222222222222';
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string], keepsUnknown = false): RouteBodyCase => ({ route, ctl, handler, today, bad, keepsUnknown });
const CASES: RouteBodyCase[] = [
  c('POST /pos/booking/verification-override', VO, 'override', [{ verificationId: I, reason: 'called the customer back', contactMethod: 'phone_call' }], [{ verificationId: { id: I } }, 'verificationId']),
  c('POST /super-admin/booking-verification/emergency-disable', VS, 'emergency', [{ disabled: true, reason: 'Twilio outage' }], [{ disabled: 'yes' }, 'disabled']),
  c('POST /super-admin/booking-verification/module', VS, 'module', [{ enabled: false, reason: 'pilot paused' }], [{ enabled: 1 }, 'enabled']),
  c('PATCH /super-admin/booking-verification/tenants/:tenantId', VS, 'tenantPolicy', [{ required: true, blocked: false, reason: 'fraud wave' }, { required: false, blocked: true, bypassBlocked: true }], [{ required: 'true' }, 'required']),
  c('PATCH /pos/settings/booking-phone-verification', VT, 'patch', [{ enabled: true }, { channels: { online: true, customerApp: false, aiReceptionist: true } }, { reverifyAfterSeconds: 3600, holdSeconds: 300 }], [{ channels: 'all' }, 'channels']),
  c('PATCH /pos/settings/booking-phone-verification/branches/:branchId', VT, 'patchBranch', [{ verifyEveryBooking: false }], [{ verifyEveryBooking: 'no' }, 'verifyEveryBooking']),
  c('POST /webhooks/twilio/booking-verification/status', VW, 'status', [{ VerificationSid: 'VE123', Status: 'approved', AccountSid: 'AC1', To: '+16095551234', Channel: 'sms' }], [{ VerificationSid: 'VE1', Status: { s: 'x' } }, 'Status'], true),
  c('POST /customer/profile/phone', PA, 'start', [{ phone: '6095551234', idempotencyKey: 'app-6095551234-1' }, { phone: '6095551234', currentPassword: 'correct horse', idempotencyKey: 'k' }], [{ phone: ['6095551234'] }, 'phone']),
  c('POST /customer/profile/phone/login-number', PA, 'changeLoginNumber', [{ phone: '6095551234', currentPassword: 'correct horse' }], [{ phone: '6095551234', currentPassword: 'x'.repeat(1025) }, 'currentPassword']),
  c('POST /customer/profile/phone/:sessionId/send', PA, 'send', [{ sessionId: I, phone: '6095551234' }], [{ sessionId: I, phone: {} }, 'phone']),
  c('POST /customer/profile/phone/:sessionId/verify', PA, 'verify', [{ sessionId: I, phone: '6095551234', code: '123456' }], [{ code: ['1'] }, 'code']),
  c('POST /customer/profile/phone/:sessionId/cancel', PA, 'cancel', [{ sessionId: I }], [{ sessionId: 5 }, 'sessionId']),
  c('POST /customer/profile/phone/verify-current/confirm', PA, 'verifyCurrentConfirm', [{ code: '123456' }], [{ code: { c: 1 } }, 'code']),
  c('PATCH /pos/settings/customer-phone', PS, 'patch', [{ requireSmsVerification: false }, { allowManualConfirmation: true, requireManagerApproval: true }], [{ requireSmsVerification: 'off' }, 'requireSmsVerification']),
  c('PATCH /pos/settings/customer-phone/branches/:branchId', PS, 'patchBranch', [{ notifyOldNumber: false }], [{ notifyOldNumber: 0 }, 'notifyOldNumber']),
  c('POST /super-admin/customer-phone/sweep', PO, 'sweep', [{ reason: 'clear stale sessions' }], [{ reason: ['x'] }, 'reason']),
  c('POST /pos/customers/:customerId/phone', P, 'start', [{ phone: '6095551234', reason: 'new number', expectedVersion: 2, idempotencyKey: 'k-1' }], [{ phone: '6095551234', expectedVersion: { v: 2 } }, 'expectedVersion']),
  c('POST /pos/customers/:customerId/phone/resolve', P, 'resolve', [{ phone: '6095551234', resolution: 'shared_family_phone', reason: 'mother and daughter' }], [{ resolution: ['shared_family_phone'] }, 'resolution']),
  c('POST /pos/customers/:customerId/phone/:sessionId/send', P, 'send', [{ phone: '6095551234' }], [{ phone: [] }, 'phone']),
  c('POST /pos/customers/:customerId/phone/:sessionId/verify', P, 'verify', [{ phone: '6095551234', code: '123456' }], [{ phone: '6095551234', code: {} }, 'code']),
  c('POST /pos/customers/:customerId/phone/:sessionId/manual-confirm', P, 'manual', [{ phone: '6095551234', reason: 'customer in front of me' }], [{ phone: '6095551234', reason: {} }, 'reason']),
];

describe('booking (round 2) — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
});
