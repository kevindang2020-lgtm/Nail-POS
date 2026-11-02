// BUILD_PLAN Phase 12 (#17): the communications routes' body validation, route by route on the real controllers — the
// bodies today's clients send pass intact, unknown fields are stripped (except on the Twilio webhooks, which keep every
// provider field because Twilio signs them all), a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared
// tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CampaignsController as CA, SuperAdminCampaignsController as SCA } from './campaigns/campaigns.controller';
import { CommunicationsController as CO, SuperAdminCommunicationsController as SCO } from './communications/communications.controller';
import { FollowUpCustomerController as FC } from './end-of-day-followups/end-of-day-followups.customer.controller';
import { FollowUpPosController as FP } from './end-of-day-followups/end-of-day-followups.pos.controller';
import { FollowUpTechController as FT } from './end-of-day-followups/end-of-day-followups.tech.controller';
import { TwilioInboundController as TI } from './messaging-inbound/twilio-inbound.controller';
import { NotificationsController as NO } from './notifications/notifications.controller';
import { PushController as PU } from './push/push.controller';
import { PosRemindersController as RE } from './reminders/reminders.controller';
import { SmsPackagesController as SP } from './sms-packages/sms-packages.controller';
import { SmsTenantPlanController as STP } from './sms-packages/sms-tenant-plan.controller';
import { TenantSmsPlanController as TSP } from './sms-packages/tenant-sms-plan.controller';
import { TenantA2pController as A2 } from './tenant-a2p/tenant-a2p.controller';
import { TenantMessagingController as TM } from './tenant-messaging/tenant-messaging.controller';
import { TenantMessagingSelfController as TMS } from './tenant-messaging/tenant-messaging.tenant.controller';

const U = '77777777-7777-4777-8777-777777777777';
const tw = { AccountSid: 'AC00000000000000000000000000000000', ApiVersion: '2010-04-01' };
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/campaigns', ctl: CA, handler: 'create', today: [{ name: 'Fall gel promo', offer: '10% off gel', channel: 'sms', audienceLabel: 'Lapsed 60d', audienceSize: 120, scheduledAt: '2026-10-20T15:00:00.000Z' }], bad: [{ name: 'x', status: 'completed' }, 'status'] },
  { route: 'PATCH /pos/campaigns/:id', ctl: CA, handler: 'update', today: [{ name: 'Fall gel promo v2', scheduledAt: null }], bad: [{ audienceSize: '120' }, 'audienceSize'] },
  { route: 'POST /super-admin/campaigns/announcements', ctl: SCA, handler: 'createAnnouncement', today: [{ title: 'Maintenance', body: 'Sunday 2am', channel: 'in_app', audienceScope: 'all', tenantIds: [], scheduledAt: null }], bad: [{ title: 'x', tenantIds: U }, 'tenantIds'] },
  { route: 'POST /super-admin/campaigns/announcements/:id/cancel', ctl: SCA, handler: 'cancelAnnouncement', today: [{ reason: 'typo' }, {}], bad: [{ reason: 1 }, 'reason'] },
  { route: 'POST /super-admin/campaigns/compliance/pause', ctl: SCA, handler: 'pauseCampaign', today: [{ subjectType: 'campaign', subjectId: U, subjectName: 'Promo', tenantId: U, currentStatus: 'active', reason: 'complaints' }], bad: [{ subjectType: 'campaign', tenantId: 5 }, 'tenantId'], keepsUnknown: false },
  { route: 'POST /super-admin/campaigns/compliance/limits', ctl: SCA, handler: 'setLimits', today: [{ maxSendsPerDay: 2, maxCampaignsPerDay: 1, quietHoursStart: 21, quietHoursEnd: 8, minHoursBetween: 24 }], bad: [{ maxSendsPerDay: '2' }, 'maxSendsPerDay'] },
  { route: 'POST /super-admin/campaigns/templates', ctl: SCA, handler: 'createTemplate', today: [{ name: 'Win-back', campaignType: 'winback', channel: 'sms', smsContent: 'We miss you {{name}}' }], bad: [{ name: ['x'] }, 'name'] },
  { route: 'POST /super-admin/campaigns/templates/:id/versions', ctl: SCA, handler: 'addTemplateVersion', today: [{ subject: 'Hi', body: 'v2', channel: 'email', notes: 'tone' }], bad: [{ body: {} }, 'body'] },
  { route: 'POST /pos/communications/threads', ctl: CO, handler: 'create', today: [{ customerId: U, customerName: 'Linh', channel: 'sms', subject: 'Appointment' }], bad: [{ customerId: [U] }, 'customerId'] },
  { route: 'POST /pos/communications/threads/:id/reply', ctl: CO, handler: 'reply', today: [{ body: 'See you at 3!' }], bad: [{ body: 3 }, 'body'] },
  { route: 'POST /pos/communications/threads/:id/assign', ctl: CO, handler: 'assign', today: [{ userId: U, userName: 'Mai' }, { userId: null, userName: null }], bad: [{ userId: {} }, 'userId'] },
  { route: 'POST /pos/communications/threads/:id/status', ctl: CO, handler: 'status', today: [{ status: 'closed' }], bad: [{ status: ['closed'] }, 'status'] },
  { route: 'POST /super-admin/communications/announcements', ctl: SCO, handler: 'createAnnouncement', today: [{ title: 'New feature', body: 'Deals are live', channel: 'in_app', priority: 'normal', recipientRoles: ['OWNER'], targetScope: 'all', idempotencyKey: 'k-1' }], bad: [{ title: 'x', recipientRoles: 'OWNER' }, 'recipientRoles'] },
  { route: 'POST /super-admin/communications/tenants/:tenantId/limits', ctl: SCO, handler: 'setLimit', today: [{ monthlySms: 5000, monthlyEmail: null, monthlyPush: null, dailyLimit: 500, enforcement: 'block', optOutRateThresholdBps: 200, status: 'active' }], bad: [{ enforcement: 'block', monthlySms: '5000' }, 'monthlySms'] },
  { route: 'POST /super-admin/communications/templates', ctl: SCO, handler: 'createTemplate', today: [{ name: 'Receipt', channel: 'email', subject: 'Your receipt', body: 'Hi {{name}}' }, { name: 'Salon promo', channel: 'sms', body: 'x', tenantId: U, category: 'marketing' }], bad: [{ name: 'x', tenantId: 9 }, 'tenantId'] },
  { route: 'POST /super-admin/communications/templates/:id/versions', ctl: SCO, handler: 'addVersion', today: [{ body: 'v2 {{name}}', subject: 'Hi' }], bad: [{ body: ['x'] }, 'body'] },
  { route: 'POST /super-admin/communications/templates/:id/versions/:version/publish', ctl: SCO, handler: 'publishVersion', today: [{}], bad: [{ tenantId: U }, 'tenantId'] },
  { route: 'POST /super-admin/communications/templates/preview', ctl: SCO, handler: 'previewTemplate', today: [{ body: 'Hi {{name}}', values: { name: 'Linh' } }], bad: [{ body: 'x', values: { name: { first: 'L' } } }, 'values.name'] },
  { route: 'POST /super-admin/communications/providers', ctl: SCO, handler: 'createProvider', today: [{ name: 'Twilio US', channel: 'sms', credential: 'not-a-real-secret', apiEndpoint: 'https://api.example.test', region: 'us1' }], bad: [{ name: 'x', credential: 1234 }, 'credential'] },
  { route: 'PATCH /super-admin/communications/providers/:id', ctl: SCO, handler: 'updateProvider', today: [{ name: 'Twilio US', priority: 10, status: 'active' }], bad: [{ name: 'x', credential: 'sneaky' }, 'credential'] },
  { route: 'POST /super-admin/communications/providers/:id/rotate-credential', ctl: SCO, handler: 'rotateProviderCredential', today: [{ credential: 'not-a-real-secret-2' }], bad: [{ credential: { v: 1 } }, 'credential'] },
  { route: 'POST /customer/follow-ups/:id/reply', ctl: FC, handler: 'reply', today: [{ text: 'Thank you!' }], bad: [{ text: 5 }, 'text'] },
  { route: 'POST /customer/follow-ups/:id/respond', ctl: FC, handler: 'respond', today: [{ message: 'Loved it' }], bad: [{ message: [] }, 'message'] },
  { route: 'POST /pos/follow-ups/:id/send', ctl: FP, handler: 'send', today: [{}, { message: 'Thanks for coming in!' }], bad: [{ message: 1 }, 'message'] },
  { route: 'POST /pos/follow-ups/:id/approve', ctl: FP, handler: 'approve', today: [{ message: 'ok' }], bad: [{ message: {} }, 'message'] },
  { route: 'POST /pos/follow-ups/:id/skip', ctl: FP, handler: 'skip', today: [{ reason: 'walk-in' }, {}], bad: [{ reason: true }, 'reason'] },
  { route: 'PATCH /pos/follow-ups/settings', ctl: FP, handler: 'saveSettings', today: [{ enabled: true, generationTime: '19:00', requireManagerApproval: false, createMode: 'end_of_day', autoExpirePendingHours: 24, defaultMessageTemplate: null }], bad: [{ enabled: 'yes' }, 'enabled'] },
  { route: 'POST /tech/follow-ups/:id/custom-message-preview', ctl: FT, handler: 'preview', today: [{ templateKey: 'thank_you' }], bad: [{ templateKey: 1 }, 'templateKey'] },
  { route: 'POST /tech/follow-ups/:id/send', ctl: FT, handler: 'send', today: [{ message: 'Thanks!' }, {}], bad: [{ message: [] }, 'message'] },
  { route: 'POST /tech/follow-ups/:id/skip', ctl: FT, handler: 'skip', today: [{ reason: 'regular' }], bad: [{ reason: {} }, 'reason'] },
  { route: 'PATCH /tech/follow-ups/:id/message', ctl: FT, handler: 'editMessage', today: [{ message: 'Thank you for visiting!' }], bad: [{ message: 7 }, 'message'] },
  { route: 'POST /webhooks/twilio/sms/inbound', ctl: TI, handler: 'inbound', today: [{ ...tw, From: '+16095551234', To: '+16095550000', Body: 'STOP', MessageSid: 'SM1', NumMedia: '0' }], bad: [{ From: ['+1'] }, 'From'], keepsUnknown: true },
  { route: 'POST /webhooks/twilio/sms/status', ctl: TI, handler: 'status', today: [{ ...tw, MessageSid: 'SM1', MessageStatus: 'delivered', To: '+16095551234' }], bad: [{ MessageStatus: { s: 1 } }, 'MessageStatus'], keepsUnknown: true },
  { route: 'POST /pos/notifications/send', ctl: NO, handler: 'send', today: [{ channel: 'sms', to: '+16095551234', body: 'Your table is ready', customerId: U }], bad: [{ channel: 'sms', to: 6095551234, body: 'x' }, 'to'] },
  { route: 'POST /pos/notifications/opt-out', ctl: NO, handler: 'optOut', today: [{ channel: 'sms', address: '+16095551234', reason: 'asked' }], bad: [{ channel: 'sms', address: [] }, 'address'] },
  { route: 'POST /pos/notifications/opt-in', ctl: NO, handler: 'optIn', today: [{ channel: 'email', address: 'linh@x.co' }], bad: [{ channel: 1, address: 'x' }, 'channel'] },
  { route: 'POST /push/register', ctl: PU, handler: 'register', today: [{ platform: 'ios', token: 'apns-token', app: 'owner' }], bad: [{ platform: 'ios', token: 123 }, 'token'] },
  { route: 'POST /push/unregister', ctl: PU, handler: 'unregister', today: [{ token: 'apns-token' }], bad: [{ token: {} }, 'token'] },
  { route: 'PATCH /pos/reminders', ctl: RE, handler: 'update', today: [{ enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' }, { enabled: false }], bad: [{ leadMinutes: '1440' }, 'leadMinutes'] },
  { route: 'POST /super-admin/sms-packages/platform-controls', ctl: SP, handler: 'setControl', today: [{ key: 'sms.emergency_send_disabled', enabled: true, reason: 'carrier incident' }], bad: [{ key: ['x'], enabled: true }, 'key'] },
  { route: 'POST /super-admin/sms-packages/default-package', ctl: SP, handler: 'setDefaultPackage', today: [{ code: 'starter', reason: 'new default' }, { code: null, reason: 'none' }], bad: [{ code: 5 }, 'code'] },
  { route: 'PATCH /super-admin/sms-packages/:packageId', ctl: SP, handler: 'update', today: [{ monthly_price_cents: 1500, included_verification_count: 500, overage_enabled: true, description: null }], bad: [{ name: { n: 1 } }, 'name'] },
  { route: 'POST /super-admin/sms-tenant-plan/reconciliation/findings/:findingId/resolve', ctl: STP, handler: 'resolve', today: [{ disposition: 'dismissed' }], bad: [{ disposition: 1 }, 'disposition'] },
  { route: 'POST /super-admin/sms-tenant-plan/:tenantId/assign', ctl: STP, handler: 'assign', today: [{ packageId: U, effective: 'next_cycle', reason: 'upgrade' }], bad: [{ packageId: {} }, 'packageId'] },
  { route: 'POST /super-admin/sms-tenant-plan/:tenantId/credit', ctl: STP, handler: 'credit', today: [{ amount: 100, reason: 'outage credit' }], bad: [{ amount: [100] }, 'amount'] },
  { route: 'POST /tenant/sms-plan/upgrade', ctl: TSP, handler: 'upgrade', today: [{ packageId: U }], bad: [{ packageId: [] }, 'packageId'] },
  { route: 'POST /super-admin/tenants/:tenantId/a2p/number', ctl: A2, handler: 'number', today: [{ phoneNumberSid: 'PN0000' }], bad: [{ phoneNumberSid: 1 }, 'phoneNumberSid'] },
  { route: 'PUT /super-admin/tenants/:tenantId/a2p/business-info', ctl: A2, handler: 'businessInfo', today: [{ businessName: 'Nails & Co', einTaxId: '12-3456789', street: '1 Main St', city: 'Merchantville', region: 'NJ', postalCode: '08109', isoCountry: 'US', repFirstName: 'Kim', repLastName: 'Le', repEmail: 'kim@x.co', repPhone: '+16095551234' }], bad: [{ businessName: { n: 1 } }, 'businessName'], keepsUnknown: true },
  { route: 'PUT /super-admin/tenants/:tenantId/a2p/inputs', ctl: A2, handler: 'saveInputs', today: [{ customerProfileBundleSid: 'BU1', brandType: 'STANDARD', campaignUsecase: 'MIXED', campaignDescription: 'Appointment reminders', messageSamples: ['Reminder: 3pm tomorrow'], hasEmbeddedLinks: false, hasEmbeddedPhone: false }], bad: [{ messageSamples: 'one' }, 'messageSamples'] },
  { route: 'POST /super-admin/tenants/:tenantId/number/buy', ctl: TM, handler: 'buyNumber', today: [{ phoneNumber: '+16095550000' }], bad: [{ phoneNumber: 16095550000 }, 'phoneNumber'] },
  { route: 'POST /super-admin/tenants/:tenantId/number/register', ctl: TM, handler: 'registerNumber', today: [{ phoneNumber: '+16095550000' }], bad: [{ phoneNumber: [] }, 'phoneNumber'] },
  { route: 'POST /super-admin/tenants/:tenantId/messaging-credentials/test', ctl: TM, handler: 'test', today: [{ to: '+16095551234' }], bad: [{ to: {} }, 'to'] },
  { route: 'PUT /super-admin/tenants/:tenantId/messaging-credentials', ctl: TM, handler: 'set', today: [{ accountSid: 'AC0', authToken: 'x', fromNumber: '+16095550000' }], bad: [{ accountSid: 0 }, 'accountSid'] },
  { route: 'POST /tenant/messaging/number/buy', ctl: TMS, handler: 'buyNumber', today: [{ phoneNumber: '+16095550000' }], bad: [{ phoneNumber: true }, 'phoneNumber'] },
  { route: 'POST /tenant/messaging/number/register', ctl: TMS, handler: 'registerNumber', today: [{ phoneNumber: '+16095550000' }], bad: [{ phoneNumber: {} }, 'phoneNumber'] },
  { route: 'POST /tenant/messaging/credentials/test', ctl: TMS, handler: 'test', today: [{ to: '+16095551234' }], bad: [{ to: 1 }, 'to'] },
  { route: 'PUT /tenant/messaging/credentials', ctl: TMS, handler: 'set', today: [{ accountSid: 'AC0', authToken: 'x', fromNumber: '+16095550000', verifyServiceSid: 'VA0' }], bad: [{ fromNumber: [] }, 'fromNumber'] },
  { route: 'PUT /tenant/messaging/credentials/branches/:branchId', ctl: TMS, handler: 'setBranch', today: [{ accountSid: 'AC0', apiKeySid: 'SK0', apiKeySecret: 'x', fromNumber: '+16095550000' }], bad: [{ apiKeySid: 1 }, 'apiKeySid'] },
];

/** Super Admin routes that READ a body tenantId (the middleware keeps it for SUPER_ADMIN only): it is declared, so the
 *  generic "undeclared tenantId is refused" probe does not apply — the declared field is type-checked instead. */
const DECLARES_TENANT = new Set(['POST /super-admin/campaigns/compliance/pause', 'POST /super-admin/communications/templates']);
describe('communications — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const fails = routeBodyFailures(c, bodyPipeOf as any);
    expect(DECLARES_TENANT.has(c.route) ? fails.filter((f) => !f.endsWith('an undeclared tenantId was accepted')) : fails).toEqual([]);
    if (DECLARES_TENANT.has(c.route)) expect((bodyPipeOf(c.ctl as any, c.handler) as any).schema.properties.tenantId).toBeTruthy();
  });
});
