// BUILD_PLAN Phase 12 (#17): body validation of the routes that live in apps/api/src (every `api:*` area), route by route
// on the real controllers — the bodies today's clients send pass intact (pos-web, owner-web, admin-web, tech-web,
// customer-web, customer-display, booking-public, the backup job and the error reporter), unknown fields are stripped,
// a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused (Super Admin routes that
// READ a tenantId declare it and type-check it instead).
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CustomerAccountController as CAc, OwnerAccountController as OAc, TechAccountController as TAc } from '../account/account.controllers';
import { AiBookingController as AB } from '../ai-booking/ai-booking.controller';
import { AiBookingPublicController as ABP } from '../ai-booking/ai-booking-public.controller';
import { AiBookingAdminController as ABA } from '../ai-booking/ai-booking-admin.controller';
import { ApiKeysController as AK, WebhooksController as WH } from '../api-webhooks/api-webhooks.controller';
import { FlagRolloutController as FR } from './platform-flags';
import { StepUpController as SU } from './step-up';
import { CustomerDisplayController as CD } from '../customer-display/customer-display.controller';
import { DisplayDevicesController as DD } from '../customer-display/display-devices.controller';
import { CustomerController as CU } from '../customer/customer.controller';
import { DeploymentsController as DE } from '../deployments/deployments.controller';
import { EventOpsController as EO } from '../events/event-ops.controller';
import { JobsController as JO } from '../jobs/jobs.controller';
import { OAuthController as OA } from '../oauth/oauth.controller';
import { BackupReportsController as BR } from '../observability/backup-reports';
import { CapacityOpsController as CO } from '../observability/capacity-ops';
import { ClientErrorsController as CE } from '../observability/client-errors.controller';
import { PosSearchController as PS } from '../pos/pos-search.controller';
import { ProfileController as PR } from '../profile/profile.controller';
import { ProjectStatusController as PJ } from '../project-status/project-status.controller';
import { PresenceController as PE } from '../realtime/presence.controller';
import { SystemStatusController as SS } from '../super-admin-system-status/super-admin-system-status.module';

const U = '88888888-8888-4888-8888-888888888888';
const CASES: RouteBodyCase[] = [
  { route: 'POST /customer/me/delete-account-request', ctl: CAc, handler: 'del', today: [{}, { reason: 'moving', contactEmail: 'l@x.co' }], bad: [{ reason: ['x'] }, 'reason'] },
  { route: 'POST /owner/me/delete-account-request', ctl: OAc, handler: 'del', today: [{}, { reason: 'closing the salon' }], bad: [{ reason: 1 }, 'reason'] },
  { route: 'POST /tech/me/delete-account-request', ctl: TAc, handler: 'del', today: [{ reason: 'retiring' }], bad: [{ reason: {} }, 'reason'] },
  { route: 'POST /api/ai-booking/v1/context', ctl: AB, handler: 'context', today: [{ source: 'FRONT_DESK_POS', correlationId: 'c-1' }, {}], bad: [{ source: 1 }, 'source'] },
  { route: 'POST /api/ai-booking/v1/availability/search', ctl: AB, handler: 'search', today: [{ source: 'AI_CHAT', date: '2026-10-09', serviceIds: [U], technicianId: U }], bad: [{ serviceIds: U }, 'serviceIds'] },
  { route: 'POST /api/ai-booking/v1/recommendations', ctl: AB, handler: 'recommend', today: [{ date: '2026-10-09', serviceIds: [U] }], bad: [{ date: 20261009 }, 'date'] },
  { route: 'POST /api/ai-booking/v1/appointments', ctl: AB, handler: 'create', today: [{ source: 'AI_CHAT', customerName: 'Linh', customerPhone: '6095551234', serviceIds: [U], date: '2026-10-09', startTime: '14:00', confirm: true, idempotencyKey: 'k-1' }], bad: [{ source: 'AI_CHAT', status: 'confirmed' }, 'status'] },
  { route: 'POST /api/ai-booking/v1/appointments/:appointmentId/reschedule', ctl: AB, handler: 'reschedule', today: [{ date: '2026-10-10', startTime: '15:00', confirm: true, idempotencyKey: 'k-2' }], bad: [{ startTime: 15 }, 'startTime'] },
  { route: 'POST /api/ai-booking/v1/appointments/:appointmentId/cancel', ctl: AB, handler: 'cancel', today: [{ reason: 'sick', confirm: true, idempotencyKey: 'k-3' }], bad: [{ reason: ['sick'] }, 'reason'] },
  { route: 'POST /api/ai-booking/v1/appointments/:appointmentId/confirm', ctl: AB, handler: 'confirm', today: [{ confirm: true, idempotencyKey: 'k-4' }], bad: [{ idempotencyKey: 4 }, 'idempotencyKey'] },
  { route: 'POST /api/ai-booking/v1/conversion-events', ctl: AB, handler: 'conversionEvent', today: [{ stage: 'slots_shown', outcome: 'ok', appointmentId: U }], bad: [{ stage: {} }, 'stage'] },
  { route: 'POST /api/ai-booking/v1/public/services', ctl: ABP, handler: 'services', today: [{ token: 'signed.link.token' }], bad: [{ token: 5 }, 'token'] },
  { route: 'POST /api/ai-booking/v1/public/availability/search', ctl: ABP, handler: 'search', today: [{ token: 't', date: '2026-10-09', serviceIds: [U] }], bad: [{ token: 't', serviceIds: [1] }, 'serviceIds[0]'] },
  { route: 'POST /api/ai-booking/v1/public/appointments', ctl: ABP, handler: 'create', today: [{ token: 't', customerName: 'Linh', customerPhone: '6095551234', serviceIds: [U], date: '2026-10-09', startTime: '14:00', confirm: true, idempotencyKey: 'k', bookingSessionId: 'bs-1', deviceId: 'd-1' }], bad: [{ token: 't', status: 'confirmed' }, 'status'] },
  { route: 'POST /api/ai-booking/v1/public/verification/send', ctl: ABP, handler: 'sendCode', today: [{ token: 't', bookingSessionId: 'bs-1', customerPhone: '6095551234', captchaToken: 'cap' }], bad: [{ token: 't', customerPhone: 6095551234 }, 'customerPhone'] },
  { route: 'POST /api/ai-booking/v1/public/verification/check', ctl: ABP, handler: 'checkCode', today: [{ token: 't', bookingSessionId: 'bs-1', customerPhone: '6095551234', code: '482913' }], bad: [{ token: 't', code: ['1'] }, 'code'] },
  { route: 'POST /super-admin/tenants/:tenantId/ai-booking/link', ctl: ABA, handler: 'mint', today: [{ source: 'ONLINE_BOOKING', branchId: U, allowedServiceIds: [U], ttlDays: 30 }], bad: [{ ttlDays: '30' }, 'ttlDays'] },
  { route: 'POST /super-admin/tenants/:tenantId/ai-booking/link/revoke', ctl: ABA, handler: 'revoke', today: [{ jti: 'jti-1', reason: 'leaked' }], bad: [{ jti: 1 }, 'jti'] },
  { route: 'POST /pos/api-keys', ctl: AK, handler: 'create', today: [{ name: 'Zapier', environment: 'live', scopes: ['customers.view'], expiresAt: null }], bad: [{ name: 'x', scopes: 'all' }, 'scopes'] },
  { route: 'POST /pos/webhooks', ctl: WH, handler: 'create', today: [{ name: 'Bookings', url: 'https://hooks.example.test/x', events: ['appointment.created'] }], bad: [{ name: 'x', url: 'https://h.example.test', events: 'all' }, 'events'] },
  { route: 'PUT /super-admin/features/:key/rollout', ctl: FR, handler: 'set', today: [{ rolloutPercent: 25, allowTenantIds: [U], denyTenantIds: [], killed: false, reason: 'canary to 25%', expectedVersion: 3 }], bad: [{ killed: 'no' }, 'killed'] },
  { route: 'POST /auth/step-up', ctl: SU, handler: 'stepUp', today: [{ password: 'correct horse' }, { password: 'x', code: '123456' }], bad: [{ password: ['x'] }, 'password'] },
  { route: 'POST /customer-display/pairing', ctl: CD, handler: 'startPairing', today: [{ platform: 'android' }, {}], bad: [{ platform: 1 }, 'platform'] },
  { route: 'POST /customer-display/pairing/:pairingId/poll', ctl: CD, handler: 'pollPairing', today: [{ pollSecret: 'abc' }], bad: [{ pollSecret: {} }, 'pollSecret'] },
  { route: 'POST /customer-display/checkout/:sessionId/tip', ctl: CD, handler: 'tip', today: [{ tipType: 'percent', percent: 20 }, { tipType: 'custom', amountCents: 500 }, { tipType: 'none' }], bad: [{ tipType: 'custom', amountCents: 5.5 }, 'amountCents'] },
  { route: 'POST /customer-display/checkout/:sessionId/method', ctl: CD, handler: 'methodSel', today: [{ method: 'card' }], bad: [{ method: 'cash', status: 'paid' }, 'status'] },
  { route: 'POST /customer-display/checkout/:sessionId/rating', ctl: CD, handler: 'rating', today: [{ rating: 5 }], bad: [{ rating: [5] }, 'rating'] },
  { route: 'POST /customer-display/checkout/:sessionId/receipt', ctl: CD, handler: 'receipt', today: [{ choice: 'sms' }, { choice: 'auto' }], bad: [{ choice: 1 }, 'choice'] },
  { route: 'POST /customer-display/device/tip', ctl: CD, handler: 'deviceTip', today: [{ tipType: 'percent', percent: 18 }], bad: [{ tipType: 'percent', percent: 180 }, 'percent'] },
  { route: 'POST /customer-display/device/method', ctl: CD, handler: 'deviceMethod', today: [{ method: 'cash' }], bad: [{ method: ['cash'] }, 'method'] },
  { route: 'POST /customer-display/device/rating', ctl: CD, handler: 'deviceRating', today: [{ rating: 4 }], bad: [{ rating: {} }, 'rating'] },
  { route: 'POST /customer-display/device/receipt', ctl: CD, handler: 'deviceReceipt', today: [{ choice: 'email' }], bad: [{ choice: [] }, 'choice'] },
  { route: 'POST /customer-display/device/phone-code', ctl: CD, handler: 'devicePhoneCode', today: [{ code: '4821' }], bad: [{ code: { c: 1 } }, 'code'] },
  { route: 'POST /customer-display/device/heartbeat', ctl: CD, handler: 'deviceHeartbeat', today: [{ mode: 'checkout', appVersion: '1.4.0', screen: { width: 1920, height: 1080, pixelRatio: 1 }, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE' }], bad: [{ screen: { width: '1920' } }, 'screen.width'] },
  { route: 'POST /customer-display/device/release', ctl: CD, handler: 'deviceRelease', today: [{ sessionId: U }], bad: [{ sessionId: 1 }, 'sessionId'] },
  { route: 'POST /customer-display/device/ads/displays', ctl: CD, handler: 'deviceAdDisplays', today: [{ batchId: 'b-1', displays: [{ adId: U, shownAt: '2026-10-08T15:00:00.000Z', durationMs: 8000 }] }], bad: [{ batchId: 'b', displays: [{ adId: U, durationMs: '8s' }] }, 'displays[0].durationMs'] },
  { route: 'POST /pos/customer-displays/pair', ctl: DD, handler: 'pair', today: [{ code: '482913', name: 'Front display', stationId: U }, { code: '482913', name: 'Lobby', stationId: null }], bad: [{ code: '1', name: { n: 1 } }, 'name'] },
  { route: 'POST /pos/customer-displays/stations', ctl: DD, handler: 'createStation', today: [{ name: 'Register 2' }], bad: [{ name: 2 }, 'name'] },
  { route: 'PATCH /pos/customer-displays/stations/:stationId', ctl: DD, handler: 'renameStation', today: [{ name: 'Front desk' }], bad: [{ name: [] }, 'name'] },
  { route: 'PATCH /pos/customer-displays/:deviceId', ctl: DD, handler: 'update', today: [{ name: 'Lobby' }, { stationId: null }, { maintenance: true }], bad: [{ maintenance: 'on' }, 'maintenance'] },
  { route: 'POST /customer/membership/join', ctl: CU, handler: 'join', today: [{ planId: U }, { planId: U, planVersionId: U }], bad: [{ planId: U, status: 'active' }, 'status'] },
  { route: 'POST /customer/me/home-salon', ctl: CU, handler: 'setHomeSalon', today: [{ salonId: U }], bad: [{ salonId: 1 }, 'salonId'] },
  { route: 'POST /customer/addresses', ctl: CU, handler: 'addAddress', today: [{ label: 'Home', line1: '1 Main St', city: 'Merchantville', state: 'NJ', zip: '08109', isDefault: true }], bad: [{ line1: 1 }, 'line1'] },
  { route: 'POST /customer/gift-cards/claim', ctl: CU, handler: 'claimGiftCard', today: [{ token: 'claim-token' }], bad: [{ token: {} }, 'token'] },
  { route: 'POST /customer/gift-cards/:id/send', ctl: CU, handler: 'sendGiftCard', today: [{ name: 'Mai', phone: '6095551234', message: 'Enjoy!' }], bad: [{ name: 'x', balanceCents: 99999 }, 'balanceCents'] },
  { route: 'PATCH /customer/profile', ctl: CU, handler: 'updateProfile', today: [{ email: 'l@x.co', smsOptIn: true, emailOptIn: false }], bad: [{ smsOptIn: 'yes' }, 'smsOptIn'] },
  { route: 'POST /pos/deployments', ctl: DE, handler: 'create', today: [{ component: 'POS app', componentKind: 'app', installedVersion: '2.3.0', latestVersion: '2.4.0', targetCount: 3, status: 'available' }], bad: [{ component: ['x'] }, 'component'] },
  { route: 'POST /pos/deployments/:id/advance', ctl: DE, handler: 'advance', today: [{ action: 'start' }], bad: [{ action: 1 }, 'action'] },
  { route: 'POST /super-admin/events/replay/preview', ctl: EO, handler: 'replayPreview', today: [{ consumerName: 'projections.queue', tenantId: U, from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }], bad: [{ consumerName: 'x', tenantId: 5 }, 'tenantId'] },
  { route: 'POST /super-admin/events/replay', ctl: EO, handler: 'replayRun', today: [{ consumerName: 'projections.queue', tenantId: U, from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z', token: 'preview-token' }], bad: [{ token: 5 }, 'token'] },
  { route: 'POST /super-admin/events/dead-letters/:id/discard', ctl: EO, handler: 'discard', today: [{}], bad: [{ tenantId: U }, 'tenantId'] },
  { route: 'POST /super-admin/jobs/self-test', ctl: JO, handler: 'selfTest', today: [{ count: 5, holdMs: 500 }], bad: [{ count: [5] }, 'count'] },
  { route: 'POST /super-admin/jobs/:id/retry', ctl: JO, handler: 'retry', today: [{ reason: 'provider back up' }], bad: [{ reason: 1 }, 'reason'] },
  { route: 'POST /super-admin/jobs/:id/cancel', ctl: JO, handler: 'cancel', today: [{ reason: 'duplicate import' }], bad: [{ reason: 'x', status: 'succeeded' }, 'status'] },
  { route: 'POST /oauth/authorize', ctl: OA, handler: 'approve', today: [{ client_id: 'c-1', redirect_uri: 'https://app.example.test/cb', scope: 'customers.read', state: 's', code_challenge: 'abc', code_challenge_method: 'S256', response_type: 'code' }], bad: [{ client_id: ['c'] }, 'client_id'] },
  { route: 'POST /oauth/token', ctl: OA, handler: 'token', today: [{ grant_type: 'authorization_code', client_id: 'c-1', code: 'code', redirect_uri: 'https://app.example.test/cb', code_verifier: 'v' }, { grant_type: 'refresh_token', client_id: 'c-1', refresh_token: 'r' }], bad: [{ grant_type: 1 }, 'grant_type'] },
  { route: 'POST /oauth/revoke', ctl: OA, handler: 'revoke', today: [{ token: 'r' }], bad: [{ token: {} }, 'token'] },
  { route: 'POST /internal/backups/report', ctl: BR, handler: 'report', today: [{ kind: 'backup', status: 'success', completedAt: '2026-10-08T03:00:00.000Z', sizeBytes: 123456, pitrEnabled: true }], bad: [{ kind: 'backup', sizeBytes: '1GB' }, 'sizeBytes'] },
  { route: 'POST /client-telemetry/errors', ctl: CE, handler: 'report', today: [{ app: 'pos-web', kind: 'render', message: 'x is undefined', stack: 'at y', route: '/pos/queue', version: '2.4.0', requestId: null }], bad: [{ app: 'pos-web', message: { m: 1 } }, 'message'] },
  { route: 'PUT /super-admin/system/cost/prices', ctl: CO, handler: 'setPrices', today: [{ prices: [{ key: 'cost.unit_price.compute.thousand_jobs', usd: 5 }], reason: 'from the October invoices' }], bad: [{ prices: { key: 'x' } }, 'prices'] },
  { route: 'PUT /super-admin/system/quotas/tenants/:tenantId', ctl: CO, handler: 'setTenantQuota', today: [{ reason: 'runaway import loop', api_requests_per_min: 600, jobs_in_flight: null, storage_bytes: null }], bad: [{ reason: 'x', jobs_in_flight: [1] }, 'jobs_in_flight'] },
  { route: 'PUT /super-admin/system/quotas/plans/:planId', ctl: CO, handler: 'setPlanQuota', today: [{ reason: 'plan sizing review', jobs_in_flight: 10 }], bad: [{ reason: 7 }, 'reason'] },
  { route: 'POST /pos/search/open', ctl: PS, handler: 'open', today: [{ resultType: 'customer', entityId: U, q: 'linh' }], bad: [{ resultType: 1 }, 'resultType'] },
  { route: 'PATCH /pos/me/login-alerts', ctl: PR, handler: 'updateLoginAlerts', today: [{ enabled: true, newDevice: true, newLocation: false }], bad: [{ enabled: 'true' }, 'enabled'] },
  { route: 'PATCH /pos/me/notification-prefs', ctl: PR, handler: 'updateNotificationPrefs', today: [{ smsNotifications: true, bookingAlerts: true, weeklyReportSummaries: false }], bad: [{ bookingAlerts: 1 }, 'bookingAlerts'] },
  { route: 'PATCH /pos/me/ui-prefs', ctl: PR, handler: 'updateUiPrefs', today: [{ defaultLanding: '/pos/queue' }], bad: [{ defaultLanding: 5 }, 'defaultLanding'] },
  { route: 'PATCH /pos/me/avatar', ctl: PR, handler: 'setAvatar', today: [{ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }, { dataUrl: null }], bad: [{ dataUrl: ['x'] }, 'dataUrl'] },
  { route: 'PATCH /super-admin/project-status/module', ctl: PJ, handler: 'recheckByBody', today: [{ moduleKey: 'aipowersalon-pos-technicians' }], bad: [{ moduleKey: 1 }, 'moduleKey'] },
  { route: 'POST /realtime/presence', ctl: PE, handler: 'report', today: [{ connectionId: 'conn-1', state: 'ONLINE' }], bad: [{ connectionId: 1, state: 'ONLINE' }, 'connectionId'] },
  { route: 'POST /super-admin/system-status/incidents', ctl: SS, handler: 'createIncident', today: [{ title: 'Checkout latency', componentKey: 'payments', severity: 'major', impact: 'slow', affectedTenants: 12 }], bad: [{ title: ['x'] }, 'title'] },
  { route: 'POST /super-admin/system-status/incidents/:id/status', ctl: SS, handler: 'updateStatus', today: [{ status: 'monitoring' }, { status: 'resolved', resolution: 'rolled back' }], bad: [{ status: 1 }, 'status'] },
  { route: 'POST /super-admin/system-status/incidents/:id/commander', ctl: SS, handler: 'assignCommander', today: [{ commander: 'kim@ops' }], bad: [{ commander: {} }, 'commander'] },
  { route: 'POST /super-admin/system-status/incidents/:id/timeline', ctl: SS, handler: 'addTimeline', today: [{ kind: 'note', body: 'mitigated', ref: null }], bad: [{ kind: 'note', body: 5 }, 'body'] },
  { route: 'POST /super-admin/system-status/public-updates', ctl: SS, handler: 'publishUpdate', today: [{ title: 'Degraded payments', body: 'Investigating', audience: 'all', incidentId: U }], bad: [{ title: 'x', incidentId: 7 }, 'incidentId'] },
  { route: 'POST /super-admin/system-status/maintenance', ctl: SS, handler: 'scheduleMaintenance', today: [{ service: 'database', scope: 'all', windowStart: '2026-10-12T07:00:00.000Z', windowEnd: '2026-10-12T08:00:00.000Z', tenantImpact: 0, owner: 'ops' }], bad: [{ service: ['db'] }, 'service'] },
  { route: 'POST /super-admin/system-status/post-incident-reports', ctl: SS, handler: 'createReport', today: [{ title: 'PIR: payments', incidentReference: 'INC-12', summary: 's', rootCause: 'r', owner: 'ops' }], bad: [{ title: 'x', summary: {} }, 'summary'] },
  { route: 'POST /super-admin/system-status/notify-tenants', ctl: SS, handler: 'notify', today: [{ message: 'Maintenance Sunday', channel: 'email', audience: 'all', incidentReference: 'INC-12' }], bad: [{ message: 1 }, 'message'] },
];
const DECLARES_TENANT = new Set(['POST /super-admin/events/replay/preview', 'POST /super-admin/events/replay']);

describe('apps/api areas — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const fails = routeBodyFailures(c, bodyPipeOf as any);
    expect(DECLARES_TENANT.has(c.route) ? fails.filter((f) => !f.endsWith('an undeclared tenantId was accepted')) : fails).toEqual([]);
  });
});
